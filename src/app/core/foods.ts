/**
 * Zamienniki składników: „nie mam brzoskwini, biorę gruszkę – ile jej wziąć?”.
 * Liczymy tak, żeby zamiennik dał tyle samo kalorii co składnik z przepisu,
 * bo tak działają tabele wymienników od dietetyczek.
 */
import { Injectable, signal } from '@angular/core';

export interface Food {
  name: string;
  group: string;
  /** wartości na 100 g produktu surowego */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodsFile {
  version: number;
  groups: Record<string, string>;
  foods: Food[];
}

export interface Swap {
  food: Food;
  /** ile gramów zamiennika odpowiada porcji z przepisu */
  grams: number;
  /** różnica białka i węglowodanów w gramach względem oryginału */
  proteinDiff: number;
  carbsDiff: number;
  fatDiff: number;
}

/** Porównywanie nazw bez ogonków, wielkości liter i końcówek w nawiasach. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Szuka produktu w tabeli po nazwie składnika z przepisu. */
export function findFood(foods: readonly Food[], ingredientName: string): Food | null {
  const q = normalizeName(ingredientName);
  if (!q) return null;
  const byName = foods.map((f) => ({ f, n: normalizeName(f.name) }));
  const exact = byName.find((x) => x.n === q);
  if (exact) return exact.f;
  // „pierś z kurczaka grillowana” → „pierś z kurczaka”; „jogurt naturalny 2% Piątnica” → „jogurt naturalny 2%”
  const contained = byName.filter((x) => q.includes(x.n) || x.n.includes(q)).sort((a, b) => b.n.length - a.n.length);
  if (contained.length) return contained[0].f;
  // ostatnia szansa: pierwsze słowo i wspólny rdzeń, np. „brzoskwinie” ≈ „brzoskwinia”
  const first = q.split(' ')[0];
  const sameStem = byName.filter((x) => stem(x.n.split(' ')[0]) === stem(first)).sort((a, b) => a.n.length - b.n.length);
  return sameStem[0]?.f ?? null;
}

/** Ile gramów zamiennika, żeby wyszło tyle samo kcal (zaokrąglone do 5 g). */
export function swapGrams(from: Food, to: Food, grams: number): number {
  if (to.kcal <= 0) return 0;
  const raw = (grams * from.kcal) / to.kcal;
  return Math.max(5, Math.round(raw / 5) * 5);
}

/** Lista zamienników z tej samej grupy, od najbliższego składem. */
export function swapsFor(foods: readonly Food[], from: Food, grams: number, limit = 12): Swap[] {
  const base = {
    protein: (from.protein * grams) / 100,
    carbs: (from.carbs * grams) / 100,
    fat: (from.fat * grams) / 100,
  };
  return foods
    .filter((f) => f.group === from.group && normalizeName(f.name) !== normalizeName(from.name))
    .map((food) => {
      const g = swapGrams(from, food, grams);
      const proteinDiff = Math.round(((food.protein * g) / 100 - base.protein) * 10) / 10;
      const carbsDiff = Math.round(((food.carbs * g) / 100 - base.carbs) * 10) / 10;
      const fatDiff = Math.round(((food.fat * g) / 100 - base.fat) * 10) / 10;
      return { food, grams: g, proteinDiff, carbsDiff, fatDiff };
    })
    .sort((a, b) => score(a) - score(b))
    .slice(0, limit);
}

/** Rdzeń słowa: obcinamy końcówkę fleksyjną, żeby „gruszki” = „gruszka”. */
function stem(word: string): string {
  return word.length > 5 ? word.slice(0, -1) : word;
}

/** Im mniejsza zmiana makro, tym wyżej na liście. */
function score(s: Swap): number {
  return Math.abs(s.proteinDiff) * 4 + Math.abs(s.carbsDiff) + Math.abs(s.fatDiff) * 2;
}

@Injectable({ providedIn: 'root' })
export class FoodStore {
  readonly foods = signal<Food[]>([]);
  readonly groups = signal<Record<string, string>>({});
  readonly loaded = signal(false);
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const res = await fetch('data/foods.json');
      if (!res.ok) throw new Error('Brak tabeli produktów');
      const file = (await res.json()) as FoodsFile;
      this.foods.set(file.foods);
      this.groups.set(file.groups);
      this.loaded.set(true);
    })();
    this.loading.catch(() => (this.loading = null));
    return this.loading;
  }

  match(ingredientName: string): Food | null {
    return findFood(this.foods(), ingredientName);
  }

  swaps(from: Food, grams: number): Swap[] {
    return swapsFor(this.foods(), from, grams);
  }

  groupLabel(key: string): string {
    return this.groups()[key] ?? key;
  }
}
