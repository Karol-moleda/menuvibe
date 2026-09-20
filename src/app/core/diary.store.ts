import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { DiaryEntryRow, MealSlot, WaterEntryRow } from './database.types';
import { RecipeSummary } from './recipe.store';
import { todayIso } from './nutrition';

export interface Totals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export type NewDiaryEntry = Pick<DiaryEntryRow, 'slot' | 'kind' | 'name' | 'kcal'> &
  Partial<Pick<DiaryEntryRow, 'recipe_id' | 'product_id' | 'grams' | 'servings' | 'protein_g' | 'carbs_g' | 'fat_g'>>;

/** Dziennik jedzenia i wody dla wybranego dnia. */
@Injectable({ providedIn: 'root' })
export class DiaryStore {
  private readonly db = inject(SupabaseService).client;

  readonly date = signal(todayIso());
  readonly entries = signal<DiaryEntryRow[]>([]);
  readonly water = signal<WaterEntryRow[]>([]);
  readonly loaded = signal(false);

  readonly totals = computed<Totals>(() => sum(this.entries()));
  readonly waterMl = computed(() => this.water().reduce((s, w) => s + w.ml, 0));
  readonly bySlot = computed(() => {
    const map = new Map<MealSlot, DiaryEntryRow[]>();
    for (const e of this.entries()) map.set(e.slot, [...(map.get(e.slot) ?? []), e]);
    return map;
  });

  async load(date = this.date()): Promise<void> {
    this.date.set(date);
    const [entries, water] = await Promise.all([
      this.db.from('diary_entries').select('*').eq('date', date).order('created_at'),
      this.db.from('water_entries').select('*').eq('date', date).order('created_at'),
    ]);
    if (entries.error) throw entries.error;
    if (water.error) throw water.error;
    this.entries.set((entries.data ?? []) as DiaryEntryRow[]);
    this.water.set((water.data ?? []) as WaterEntryRow[]);
    this.loaded.set(true);
  }

  async add(entry: NewDiaryEntry): Promise<DiaryEntryRow> {
    const { data, error } = await this.db
      .from('diary_entries')
      .insert({ date: this.date(), ...entry })
      .select('*')
      .single();
    if (error) throw error;
    const row = data as DiaryEntryRow;
    this.entries.update((l) => [...l, row]);
    return row;
  }

  /** Wpis z przepisu: wartości na porcję × mnożnik porcji. */
  addRecipe(recipe: RecipeSummary, slot: MealSlot, servings: number): Promise<DiaryEntryRow> {
    return this.add({
      slot,
      kind: 'recipe',
      recipe_id: recipe.id,
      name: recipe.name,
      servings,
      kcal: Math.round(recipe.kcal * servings),
      protein_g: round1(recipe.protein_g * servings),
      carbs_g: round1(recipe.carbs_g * servings),
      fat_g: round1(recipe.fat_g * servings),
    });
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('diary_entries').delete().eq('id', id);
    if (error) throw error;
    this.entries.update((l) => l.filter((e) => e.id !== id));
  }

  async addWater(ml: number): Promise<void> {
    const { data, error } = await this.db.from('water_entries').insert({ date: this.date(), ml }).select('*').single();
    if (error) throw error;
    this.water.update((l) => [...l, data as WaterEntryRow]);
  }

  /** Cofa ostatni wpis wody. */
  async undoWater(): Promise<void> {
    const last = this.water().at(-1);
    if (!last) return;
    const { error } = await this.db.from('water_entries').delete().eq('id', last.id);
    if (error) throw error;
    this.water.update((l) => l.slice(0, -1));
  }

  /** Czy zaplanowany przepis został już zapisany w dzienniku tego dnia. */
  isLogged(recipeId: string, slot: MealSlot): boolean {
    return this.entries().some((e) => e.recipe_id === recipeId && e.slot === slot);
  }
}

export function sum(entries: readonly Pick<DiaryEntryRow, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>[]): Totals {
  return entries.reduce(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      protein_g: t.protein_g + Number(e.protein_g),
      carbs_g: t.carbs_g + Number(e.carbs_g),
      fat_g: t.fat_g + Number(e.fat_g),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
