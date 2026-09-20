import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { MealPlanItemRow, MealPlanRow, MealSlot, ProfileRow } from './database.types';
import { BodyStore } from './body.store';
import { RecipeStore } from './recipe.store';
import { PlanCell, balanceDay, factorFor, generateWeek, mondayOf, slotTargets } from './planner';
import { addDays } from './nutrition';

/** Tygodniowy jadłospis: generowanie, podmiana, blokowanie posiłków. */
@Injectable({ providedIn: 'root' })
export class PlanStore {
  private readonly db = inject(SupabaseService).client;
  private readonly body = inject(BodyStore);
  private readonly recipes = inject(RecipeStore);

  readonly weekStart = signal(mondayOf(this.body.today()));
  readonly plan = signal<MealPlanRow | null>(null);
  readonly items = signal<MealPlanItemRow[]>([]);
  readonly loading = signal(false);

  readonly dailyKcal = computed(() => this.body.currentTarget()?.kcal ?? null);
  readonly slotTargets = computed(() => {
    const kcal = this.dailyKcal();
    const split = this.body.profile()?.slot_split as ProfileRow['slot_split'] | undefined;
    return kcal ? slotTargets(kcal, hasSplit(split) ? split : undefined) : null;
  });

  readonly itemsByDate = computed(() => {
    const map = new Map<string, MealPlanItemRow[]>();
    for (const i of this.items()) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return map;
  });

  async loadWeek(weekStart = this.weekStart()): Promise<void> {
    this.weekStart.set(weekStart);
    this.loading.set(true);
    try {
      const { data: plan, error } = await this.db.from('meal_plans').select('*').eq('week_start', weekStart).maybeSingle();
      if (error) throw error;
      this.plan.set(plan as MealPlanRow | null);
      if (!plan) {
        this.items.set([]);
        return;
      }
      const res = await this.db.from('meal_plan_items').select('*').eq('plan_id', plan.id).order('date');
      if (res.error) throw res.error;
      this.items.set((res.data ?? []) as MealPlanItemRow[]);
    } finally {
      this.loading.set(false);
    }
  }

  /** Posiłki zaplanowane na dany dzień (niezależnie od wczytanego tygodnia). */
  async itemsForDate(date: string): Promise<MealPlanItemRow[]> {
    const { data, error } = await this.db.from('meal_plan_items').select('*').eq('date', date);
    if (error) throw error;
    return (data ?? []) as MealPlanItemRow[];
  }

  /** Generuje (albo przelosowuje) tydzień; zablokowane posiłki zostają. */
  async generate(): Promise<void> {
    const kcal = this.dailyKcal();
    if (!kcal) throw new Error('Najpierw ustaw cel kalorii w profilu.');
    await this.recipes.load();
    const weekStart = this.weekStart();

    const previous = await this.db
      .from('meal_plan_items')
      .select('recipe_id')
      .gte('date', addDays(weekStart, -7))
      .lt('date', weekStart);
    if (previous.error) throw previous.error;

    const locked: PlanCell[] = this.items()
      .filter((i) => i.locked)
      .map((i) => ({ date: i.date, slot: i.slot, recipeId: i.recipe_id, portionFactor: Number(i.portion_factor), locked: true }));

    const cells = generateWeek({
      weekStart,
      dailyKcal: kcal,
      split: this.slotTargetsSplit(),
      recipes: this.recipes.forPlanner(),
      avoidIds: new Set((previous.data ?? []).map((r) => r.recipe_id)),
      locked,
    });

    const plan = await this.ensurePlan(weekStart);
    // usuń niezablokowane i wstaw nowe
    const del = await this.db.from('meal_plan_items').delete().eq('plan_id', plan.id).eq('locked', false);
    if (del.error) throw del.error;
    const fresh = cells.filter((c) => !c.locked);
    const ins = await this.db
      .from('meal_plan_items')
      .insert(fresh.map((c) => ({ plan_id: plan.id, date: c.date, slot: c.slot, recipe_id: c.recipeId, portion_factor: c.portionFactor, locked: false })))
      .select('*');
    if (ins.error) throw ins.error;
    this.items.set(
      [...this.items().filter((i) => i.locked), ...((ins.data ?? []) as MealPlanItemRow[])].sort(bySlotAndDate),
    );
  }

  /** Podmienia przepis w komórce i dobiera porcję do celu slotu, po czym wyrównuje dzień. */
  async swap(item: MealPlanItemRow, recipeId: string): Promise<void> {
    const recipe = this.recipes.byId().get(recipeId);
    const target = this.slotTargets()?.[item.slot];
    if (!recipe || !target) return;
    const updated = { ...item, recipe_id: recipeId, portion_factor: factorFor(recipe.kcal, target) };
    await this.saveDay(item.date, this.items().map((i) => (i.id === item.id ? updated : i)), item.id);
  }

  /**
   * Wstawia przepis w plan na dany dzień i posiłek (zastępuje to, co tam było).
   * Porcja 1 – przepisy od Claude są już dopasowane do kalorii posiłku.
   */
  async putOnDate(date: string, slot: MealSlot, recipeId: string): Promise<void> {
    const plan = await this.ensurePlan(mondayOf(date));
    const { error } = await this.db
      .from('meal_plan_items')
      .upsert({ plan_id: plan.id, date, slot, recipe_id: recipeId, portion_factor: 1, locked: true }, { onConflict: 'plan_id,date,slot' });
    if (error) throw error;
    if (plan.week_start === this.weekStart()) await this.loadWeek(plan.week_start);
  }

  async setPortion(item: MealPlanItemRow, factor: number): Promise<void> {
    await this.update(item.id, { portion_factor: factor });
  }

  async toggleLock(item: MealPlanItemRow): Promise<void> {
    await this.update(item.id, { locked: !item.locked });
  }

  private async update(id: string, patch: Partial<Pick<MealPlanItemRow, 'portion_factor' | 'locked' | 'recipe_id'>>): Promise<void> {
    const { error } = await this.db.from('meal_plan_items').update(patch).eq('id', id);
    if (error) throw error;
    this.items.update((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  /** Zapisuje zmieniony dzień; porcje pozostałych niezablokowanych posiłków są wyrównywane do celu. */
  private async saveDay(date: string, all: MealPlanItemRow[], changedId: string): Promise<void> {
    const kcal = this.dailyKcal();
    const day = all.filter((i) => i.date === date);
    const cells = day.map((i) => ({
      date: i.date,
      slot: i.slot,
      recipeId: i.recipe_id,
      portionFactor: Number(i.portion_factor),
      // podmieniony posiłek traktujemy jak zablokowany, żeby dopasować pozostałe
      locked: i.locked || i.id === changedId,
    }));
    const balanced = kcal ? balanceDay(cells, this.recipes.forPlanner(), kcal) : cells;
    for (const [idx, item] of day.entries()) {
      const patch = { recipe_id: item.recipe_id, portion_factor: balanced[idx].portionFactor };
      const orig = this.items().find((i) => i.id === item.id)!;
      if (orig.recipe_id !== patch.recipe_id || Number(orig.portion_factor) !== patch.portion_factor) {
        await this.update(item.id, patch);
      }
    }
  }

  private async ensurePlan(weekStart: string): Promise<MealPlanRow> {
    const existing = this.plan();
    if (existing && existing.week_start === weekStart) return existing;
    const { data, error } = await this.db
      .from('meal_plans')
      .upsert({ week_start: weekStart }, { onConflict: 'user_id,week_start' })
      .select('*')
      .single();
    if (error) throw error;
    if (weekStart === this.weekStart()) this.plan.set(data as MealPlanRow);
    return data as MealPlanRow;
  }

  private slotTargetsSplit(): Record<MealSlot, number> | undefined {
    const split = this.body.profile()?.slot_split as ProfileRow['slot_split'] | undefined;
    return hasSplit(split) ? split : undefined;
  }
}

const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, snack: 1, lunch: 2, dinner: 3 };

function bySlotAndDate(a: MealPlanItemRow, b: MealPlanItemRow): number {
  return a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
}

function hasSplit(s: unknown): s is Record<MealSlot, number> {
  return !!s && typeof s === 'object' && ['breakfast', 'snack', 'lunch', 'dinner'].every((k) => typeof (s as Record<string, unknown>)[k] === 'number');
}
