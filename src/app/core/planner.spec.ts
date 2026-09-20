import recipesJson from '../../../data/recipes.json';
import {
  PlannerRecipe,
  SLOTS,
  alternatives,
  balanceDay,
  dayKcal,
  factorFor,
  generateWeek,
  mondayOf,
  seededRandom,
  slotTargets,
  weekDates,
} from './planner';

/** Prawdziwa baza 248 przepisów z PDF-ów. */
const data = recipesJson as unknown as {
  recipes: { id: string; slot: PlannerRecipe['slot']; per_serving: { kcal: number } }[];
};
const recipes: PlannerRecipe[] = data.recipes.map((r) => ({ id: r.id, slot: r.slot, kcal: r.per_serving.kcal, rating: 0 }));

describe('daty tygodnia', () => {
  it('poniedziałek tygodnia', () => {
    expect(mondayOf('2026-09-20')).toBe('2026-09-14'); // niedziela
    expect(mondayOf('2026-09-21')).toBe('2026-09-21'); // poniedziałek
    expect(weekDates('2026-09-21')).toHaveLength(7);
  });
});

describe('cele slotów i porcje', () => {
  it('dzieli kcal 30/10/30/30', () => {
    expect(slotTargets(2400)).toEqual({ breakfast: 720, snack: 240, lunch: 720, dinner: 720 });
  });

  it('mnożnik porcji w granicach 0,7–1,3', () => {
    expect(factorFor(700, 720)).toBe(1.05);
    expect(factorFor(300, 720)).toBe(1.3);
    expect(factorFor(1200, 720)).toBe(0.7);
  });
});

describe('generator tygodnia', () => {
  const week = generateWeek({ weekStart: '2026-09-21', dailyKcal: 2400, recipes, random: seededRandom(1) });

  it('wypełnia 28 posiłków bez powtórzeń', () => {
    expect(week).toHaveLength(28);
    expect(new Set(week.map((c) => c.recipeId)).size).toBe(28);
  });

  it('każdy dzień mieści się w ±5% celu', () => {
    for (const date of weekDates('2026-09-21')) {
      const kcal = dayKcal(week.filter((c) => c.date === date), recipes);
      expect(Math.abs(kcal - 2400) / 2400).toBeLessThanOrEqual(0.05);
    }
  });

  it('przepis trafia do właściwego slotu', () => {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    for (const c of week) expect(byId.get(c.recipeId)!.slot).toBe(c.slot);
  });

  it('unika przepisów z poprzedniego tygodnia', () => {
    const next = generateWeek({
      weekStart: '2026-09-28',
      dailyKcal: 2400,
      recipes,
      avoidIds: new Set(week.map((c) => c.recipeId)),
      random: seededRandom(2),
    });
    const overlap = next.filter((c) => week.some((w) => w.recipeId === c.recipeId));
    expect(overlap).toHaveLength(0);
  });

  it('zostawia zablokowane posiłki', () => {
    const locked = [{ ...week[0], locked: true }];
    const again = generateWeek({ weekStart: '2026-09-21', dailyKcal: 2400, recipes, locked, random: seededRandom(3) });
    expect(again.find((c) => c.date === week[0].date && c.slot === week[0].slot)).toEqual(locked[0]);
  });

  it('pomija przepisy „nie lubię”', () => {
    const disliked = recipes.map((r) => (r.slot === 'snack' ? { ...r, rating: r.id.length % 2 ? -1 : 0 } : r));
    const w = generateWeek({ weekStart: '2026-09-21', dailyKcal: 2400, recipes: disliked, random: seededRandom(4) });
    const byId = new Map(disliked.map((r) => [r.id, r]));
    expect(w.every((c) => byId.get(c.recipeId)!.rating >= 0)).toBe(true);
  });

  it('trzyma ±5% dla 30 losowań i różnych celów', () => {
    for (let seed = 10; seed < 40; seed++) {
      const kcal = 1800 + (seed % 6) * 150;
      const w = generateWeek({ weekStart: '2026-09-21', dailyKcal: kcal, recipes, random: seededRandom(seed) });
      expect(w).toHaveLength(28);
      for (const date of weekDates('2026-09-21')) {
        const day = dayKcal(w.filter((c) => c.date === date), recipes);
        expect(Math.abs(day - kcal) / kcal).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('działa dla innego celu (1900 kcal)', () => {
    const w = generateWeek({ weekStart: '2026-09-21', dailyKcal: 1900, recipes, random: seededRandom(5) });
    for (const date of weekDates('2026-09-21')) {
      const kcal = dayKcal(w.filter((c) => c.date === date), recipes);
      expect(Math.abs(kcal - 1900) / 1900).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('podmiana i bilans dnia', () => {
  it('alternatywy z tego samego slotu, najbliższe kcal pierwsze', () => {
    const alts = alternatives(recipes, 'lunch', 720);
    expect(alts.every((r) => r.slot === 'lunch')).toBe(true);
    const first = Math.abs(Math.log(720 / alts[0].kcal));
    const last = Math.abs(Math.log(720 / alts[alts.length - 1].kcal));
    expect(first).toBeLessThanOrEqual(last);
  });

  it('bilans dnia dociąga porcje do celu', () => {
    const r: PlannerRecipe[] = SLOTS.map((slot, i) => ({ id: `r${i}`, slot, kcal: slot === 'snack' ? 200 : 600, rating: 0 }));
    const day = SLOTS.map((slot, i) => ({ date: '2026-09-21', slot, recipeId: `r${i}`, portionFactor: 1, locked: false }));
    const balanced = balanceDay(day, r, 2400);
    expect(Math.abs(dayKcal(balanced, r) - 2400) / 2400).toBeLessThanOrEqual(0.05);
  });
});
