import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { MealSlot, RecipeIngredientRow, RecipeOrigin, RecipeRow } from './database.types';
import { PlannerRecipe } from './planner';
import { ingredientCategory } from './categories';
import type { ProposedRecipe } from './chat.store';

/** Format pliku data/recipes.json (wynik parsera PDF). */
interface RecipeFile {
  version: number;
  recipes: {
    id: string;
    name: string;
    slot: MealSlot;
    servings: number;
    per_serving: { kcal: number; protein: number; carbs: number; fat: number };
    macros_estimated: boolean;
    ingredients: { name: string; amount: number; unit: string; household: string | null; category: string; group?: string }[];
    steps: string[];
    origin: RecipeOrigin;
    sources: unknown[];
    tags: string[];
  }[];
  substitutions: { section: string | null; note: string | null; items: unknown[] }[];
}

export type RecipeSummary = Pick<
  RecipeRow,
  'id' | 'slug' | 'name' | 'slot' | 'servings' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'macros_estimated' | 'origin' | 'rating' | 'tags'
>;

const SUMMARY_COLUMNS = 'id,slug,name,slot,servings,kcal,protein_g,carbs_g,fat_g,macros_estimated,origin,rating,tags';

@Injectable({ providedIn: 'root' })
export class RecipeStore {
  private readonly db = inject(SupabaseService).client;

  readonly recipes = signal<RecipeSummary[]>([]);
  readonly loaded = signal(false);
  readonly importing = signal(false);
  private loading: Promise<void> | null = null;

  readonly byId = computed(() => new Map(this.recipes().map((r) => [r.id, r])));
  readonly forPlanner = computed<PlannerRecipe[]>(() =>
    this.recipes().map((r) => ({ id: r.id, slot: r.slot, kcal: r.kcal, rating: r.rating })),
  );

  /** Wczytuje przepisy; przy pierwszym uruchomieniu importuje bazę z PDF-ów. */
  load(force = false): Promise<void> {
    if (this.loading && !force) return this.loading;
    this.loading = (async () => {
      let rows = await this.fetchAll();
      if (rows.length === 0 || !(await this.hasIngredients())) {
        await this.importBundled();
        rows = await this.fetchAll();
      }
      this.recipes.set(rows);
      this.loaded.set(true);
    })();
    this.loading.catch(() => (this.loading = null));
    return this.loading;
  }

  async ingredients(recipeId: string): Promise<RecipeIngredientRow[]> {
    const { data, error } = await this.db.from('recipe_ingredients').select('*').eq('recipe_id', recipeId).order('position');
    if (error) throw error;
    return (data ?? []) as RecipeIngredientRow[];
  }

  async details(recipeId: string): Promise<RecipeRow> {
    const { data, error } = await this.db.from('recipes').select('*').eq('id', recipeId).single();
    if (error) throw error;
    return data as RecipeRow;
  }

  async setRating(recipeId: string, rating: -1 | 0 | 1): Promise<void> {
    const { error } = await this.db.from('recipes').update({ rating }).eq('id', recipeId);
    if (error) throw error;
    this.recipes.update((list) => list.map((r) => (r.id === recipeId ? { ...r, rating } : r)));
  }

  /** Zapisuje przepis zaproponowany przez Claude w bazie przepisów (trafia też do generatora tygodnia). */
  async createFromProposal(p: ProposedRecipe): Promise<RecipeSummary> {
    await this.load();
    const slug = `claude-${slugify(p.name)}-${Date.now().toString(36)}`;
    const { data, error } = await this.db
      .from('recipes')
      .insert({
        slug,
        name: p.name,
        slot: p.slot,
        servings: p.servings,
        kcal: Math.round(p.per_serving.kcal),
        protein_g: p.per_serving.protein_g,
        carbs_g: p.per_serving.carbs_g,
        fat_g: p.per_serving.fat_g,
        macros_estimated: true,
        steps: p.note ? [...p.steps, `Uwaga: ${p.note}`] : p.steps,
        origin: 'claude',
        prep_minutes: p.prep_minutes,
        tags: ['od Claude'],
      })
      .select(SUMMARY_COLUMNS)
      .single();
    if (error) throw error;
    const recipe = data as RecipeSummary;
    const ing = await this.db.from('recipe_ingredients').insert(
      p.ingredients.map((i, position) => ({
        recipe_id: recipe.id,
        position,
        name: i.name,
        amount: i.grams,
        unit: 'g',
        household: i.household,
        category: ingredientCategory(i.name),
      })),
    );
    if (ing.error) throw ing.error;
    this.recipes.update((l) => [...l, recipe].sort((a, b) => a.name.localeCompare(b.name, 'pl')));
    return recipe;
  }

  private async hasIngredients(): Promise<boolean> {
    const { data, error } = await this.db.from('recipe_ingredients').select('id').limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  private async fetchAll(): Promise<RecipeSummary[]> {
    const { data, error } = await this.db.from('recipes').select(SUMMARY_COLUMNS).eq('archived', false).order('name');
    if (error) throw error;
    return (data ?? []) as RecipeSummary[];
  }

  /** Import 248 przepisów i listy wymienników z data/recipes.json (dołączonego do aplikacji). Można go bezpiecznie powtórzyć. */
  private async importBundled(): Promise<void> {
    this.importing.set(true);
    try {
      const res = await fetch('data/recipes.json');
      if (!res.ok) throw new Error('Brak pliku z przepisami');
      const file = (await res.json()) as RecipeFile;

      const ids = new Map<string, string>();
      for (const batch of chunks(file.recipes, 100)) {
        const { data, error } = await this.db
          .from('recipes')
          .upsert(
            batch.map((r) => ({
              slug: r.id,
              name: r.name,
              slot: r.slot,
              servings: r.servings,
              kcal: r.per_serving.kcal,
              protein_g: r.per_serving.protein,
              carbs_g: r.per_serving.carbs,
              fat_g: r.per_serving.fat,
              macros_estimated: r.macros_estimated,
              steps: r.steps,
              origin: r.origin,
              sources: r.sources as never,
              tags: r.tags,
            })),
            { onConflict: 'user_id,slug' },
          )
          .select('id,slug');
        if (error) throw error;
        for (const row of data ?? []) ids.set(row.slug, row.id);
      }

      // import jest powtarzalny: przy ponownej próbie czyścimy składniki i wymienniki
      for (const batch of chunks([...ids.values()], 100)) {
        const { error } = await this.db.from('recipe_ingredients').delete().in('recipe_id', batch);
        if (error) throw error;
      }
      const cleared = await this.db.from('substitutions').delete().gte('position', 0);
      if (cleared.error) throw cleared.error;

      const ingredients = file.recipes.flatMap((r) =>
        r.ingredients.map((i, position) => ({
          recipe_id: ids.get(r.id)!,
          position,
          name: i.name,
          amount: i.amount,
          unit: i.unit,
          household: i.household,
          category: i.category,
          grp: i.group ?? null,
        })),
      );
      for (const batch of chunks(ingredients, 500)) {
        const { error } = await this.db.from('recipe_ingredients').insert(batch);
        if (error) throw error;
      }

      const { error } = await this.db
        .from('substitutions')
        .insert(file.substitutions.map((s, position) => ({ section: s.section, note: s.note, items: s.items as never, position })));
      if (error) throw error;
    } finally {
      this.importing.set(false);
    }
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
