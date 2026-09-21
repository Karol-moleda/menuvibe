import { Food, findFood, normalizeName, swapGrams, swapsFor } from './foods';

const foods: Food[] = [
  { name: 'Brzoskwinia', group: 'owoce', kcal: 39, protein: 0.9, carbs: 10, fat: 0.3 },
  { name: 'Gruszka', group: 'owoce', kcal: 57, protein: 0.4, carbs: 15, fat: 0.1 },
  { name: 'Banan', group: 'owoce', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { name: 'Pierś z kurczaka', group: 'mięso i ryby', kcal: 110, protein: 23, carbs: 0, fat: 1.8 },
  { name: 'Dorsz', group: 'mięso i ryby', kcal: 80, protein: 18, carbs: 0, fat: 0.7 },
];

describe('zamienniki składników', () => {
  it('rozpoznaje składnik mimo ogonków, wielkości liter i dopisków', () => {
    expect(normalizeName('Brzoskwinia (świeża)')).toBe('brzoskwinia');
    expect(findFood(foods, 'brzoskwinie')?.name).toBe('Brzoskwinia');
    expect(findFood(foods, 'Pierś z kurczaka grillowana')?.name).toBe('Pierś z kurczaka');
    expect(findFood(foods, 'Kawa')).toBeNull();
  });

  it('przelicza gramy tak, żeby zgadzały się kalorie', () => {
    const peach = foods[0];
    const pear = foods[1];
    // 150 g brzoskwini to 58,5 kcal; gruszka ma 57 kcal/100 g → ok. 105 g
    expect(swapGrams(peach, pear, 150)).toBe(105);
    expect(swapGrams(peach, foods[2], 150)).toBe(65);
  });

  it('proponuje tylko produkty z tej samej grupy i liczy różnicę makro', () => {
    const swaps = swapsFor(foods, foods[0], 150);
    expect(swaps.map((s) => s.food.name).sort()).toEqual(['Banan', 'Gruszka']);
    expect(swaps.every((s) => s.food.group === 'owoce')).toBe(true);
    const pear = swaps.find((s) => s.food.name === 'Gruszka')!;
    expect(pear.grams).toBe(105);
    expect(pear.carbsDiff).toBeCloseTo(0.8, 1);
    // najbliżej składem jest banan – mniejsza różnica węglowodanów
    expect(swaps[0].food.name).toBe('Banan');
  });

  it('nie proponuje ryby zamiast owocu', () => {
    expect(swapsFor(foods, foods[3], 120).map((s) => s.food.name)).toEqual(['Dorsz']);
  });
});
