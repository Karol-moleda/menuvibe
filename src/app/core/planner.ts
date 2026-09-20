/**
 * Generator tygodniowego jadłospisu – czysta logika, bez Angulara i Supabase.
 *
 * Zasady:
 * - 7 dni × 4 sloty, bez powtórzeń przepisu w tygodniu (dopóki pula na to pozwala),
 * - przepisy z poprzedniego tygodnia i ocenione „nie lubię” są pomijane, „lubię” ma większą szansę,
 * - porcja jest skalowana (mnożnik 0,7–1,3) do celu kcal slotu,
 * - suma dnia jest dociągana do celu dziennego (±5%) przez korektę porcji.
 */
import { MealSlot } from './database.types';
import { addDays } from './nutrition';

export const SLOTS: readonly MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];
export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Śniadanie',
  snack: 'Przekąska',
  lunch: 'Obiad',
  dinner: 'Kolacja',
};
export const DEFAULT_SPLIT: Record<MealSlot, number> = { breakfast: 30, snack: 10, lunch: 30, dinner: 30 };

export const MIN_FACTOR = 0.7;
export const MAX_FACTOR = 1.3;
export const DAY_TOLERANCE = 0.05;

export interface PlannerRecipe {
  id: string;
  slot: MealSlot;
  kcal: number;
  rating: number;
}

export interface PlanCell {
  date: string;
  slot: MealSlot;
  recipeId: string;
  portionFactor: number;
  locked: boolean;
}

export interface GenerateOptions {
  weekStart: string;
  dailyKcal: number;
  split?: Record<MealSlot, number>;
  recipes: readonly PlannerRecipe[];
  /** przepisy z poprzedniego tygodnia – unikane, jeśli to możliwe */
  avoidIds?: ReadonlySet<string>;
  /** komórki zablokowane – zostają bez zmian */
  locked?: readonly PlanCell[];
  random?: () => number;
}

/** Poniedziałek tygodnia, w którym jest data. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = poniedziałek
  return addDays(iso, -dow);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function slotTargets(dailyKcal: number, split: Record<MealSlot, number> = DEFAULT_SPLIT): Record<MealSlot, number> {
  const total = SLOTS.reduce((s, k) => s + split[k], 0) || 100;
  return Object.fromEntries(SLOTS.map((k) => [k, Math.round((dailyKcal * split[k]) / total)])) as Record<MealSlot, number>;
}

export function roundFactor(f: number): number {
  return Math.round(clamp(f, MIN_FACTOR, MAX_FACTOR) * 20) / 20;
}

export function factorFor(recipeKcal: number, targetKcal: number): number {
  return roundFactor(targetKcal / recipeKcal);
}

/** Alternatywy do podmiany: ten sam slot, posortowane wg bliskości kcal do celu slotu. */
export function alternatives(
  recipes: readonly PlannerRecipe[],
  slot: MealSlot,
  targetKcal: number,
  excludeIds: ReadonlySet<string> = new Set(),
): PlannerRecipe[] {
  return recipes
    .filter((r) => r.slot === slot && r.rating >= 0 && !excludeIds.has(r.id))
    .sort((a, b) => score(a, targetKcal) - score(b, targetKcal));
}

export function generateWeek(o: GenerateOptions): PlanCell[] {
  const rnd = o.random ?? Math.random;
  const targets = slotTargets(o.dailyKcal, o.split);
  const dates = weekDates(o.weekStart);
  const locked = new Map((o.locked ?? []).map((c) => [`${c.date}|${c.slot}`, c]));
  const used = new Set((o.locked ?? []).map((c) => c.recipeId));
  const avoid = o.avoidIds ?? new Set<string>();

  const cells: PlanCell[] = [];
  for (const date of dates) {
    const day: PlanCell[] = [];
    for (const slot of SLOTS) {
      const fixed = locked.get(`${date}|${slot}`);
      if (fixed) {
        day.push({ ...fixed });
        continue;
      }
      const recipe = pick(o.recipes, slot, targets[slot], used, avoid, rnd);
      if (!recipe) continue;
      used.add(recipe.id);
      day.push({ date, slot, recipeId: recipe.id, portionFactor: factorFor(recipe.kcal, targets[slot]), locked: false });
    }
    cells.push(...balanceDay(day, o.recipes, o.dailyKcal));
  }
  return cells;
}

/**
 * Dociąga sumę dnia do celu (±5%), zmieniając porcje niezablokowanych posiłków
 * proporcjonalnie, w granicach 0,7–1,3.
 */
export function balanceDay(day: PlanCell[], recipes: readonly PlannerRecipe[], dailyKcal: number): PlanCell[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const kcalOf = (c: PlanCell) => (byId.get(c.recipeId)?.kcal ?? 0) * c.portionFactor;
  const result = day.map((c) => ({ ...c }));
  for (let i = 0; i < 3; i++) {
    const total = result.reduce((s, c) => s + kcalOf(c), 0);
    if (!total || Math.abs(total - dailyKcal) / dailyKcal <= DAY_TOLERANCE) break;
    const adjustable = result.filter((c) => !c.locked);
    const adjustableKcal = adjustable.reduce((s, c) => s + kcalOf(c), 0);
    if (!adjustableKcal) break;
    const scale = 1 + (dailyKcal - total) / adjustableKcal;
    for (const c of adjustable) c.portionFactor = roundFactor(c.portionFactor * scale);
  }
  return result;
}

export function dayKcal(day: readonly PlanCell[], recipes: readonly PlannerRecipe[]): number {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  return Math.round(day.reduce((s, c) => s + (byId.get(c.recipeId)?.kcal ?? 0) * c.portionFactor, 0));
}

function pick(
  recipes: readonly PlannerRecipe[],
  slot: MealSlot,
  target: number,
  used: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  rnd: () => number,
): PlannerRecipe | null {
  const inSlot = recipes.filter((r) => r.slot === slot && r.rating >= 0);
  const fits = (r: PlannerRecipe) => target / r.kcal >= MIN_FACTOR && target / r.kcal <= MAX_FACTOR;
  // kolejne poziomy luzowania, gdy pula jest za mała
  const tiers = [
    inSlot.filter((r) => fits(r) && !used.has(r.id) && !avoid.has(r.id)),
    inSlot.filter((r) => fits(r) && !used.has(r.id)),
    inSlot.filter((r) => !used.has(r.id)),
    inSlot,
  ];
  const pool = tiers.find((t) => t.length > 0);
  if (!pool) return null;
  const weights = pool.map((r) => (r.rating > 0 ? 2 : 1));
  let x = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function score(r: PlannerRecipe, target: number): number {
  const factor = target / r.kcal;
  const outside = factor < MIN_FACTOR || factor > MAX_FACTOR ? 10 : 0;
  return outside + Math.abs(Math.log(factor)) - (r.rating > 0 ? 0.05 : 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministyczny generator liczb losowych (do testów i powtarzalnych wyników). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
