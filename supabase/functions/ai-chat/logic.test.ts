// deno test supabase/functions/ai-chat/logic.test.ts
import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { DayContext, parseReply, sanitizeRecipe, slotBudget, systemPrompt } from './logic.ts';

const ctx: DayContext = {
  date: '2026-09-20',
  goal: 'cut',
  target: { kcal: 2150, protein_g: 161, carbs_g: 231, fat_g: 60 },
  eaten: { kcal: 1300, protein_g: 80, carbs_g: 150, fat_g: 40 },
  eatenItems: [{ slot: 'breakfast', name: 'Owsianka', kcal: 650 }],
  planned: [{ slot: 'snack', name: 'Skyr z owocami', kcal: 215 }],
  slotSplit: { breakfast: 30, snack: 10, lunch: 30, dinner: 30 },
};

Deno.test('budżet slotu: cel kolacji ograniczony do tego, co zostało po zaplanowanej przekąsce', () => {
  const b = slotBudget(ctx, 'dinner');
  assertEquals(b.remainingDay, 850);
  // 30% z 2150 = 645; zostało 850 - 215 (przekąska) = 635
  assertEquals(b.slotTarget, 635);
});

Deno.test('prompt zawiera cel, bilans i posiłek', () => {
  const p = systemPrompt(ctx, 'dinner');
  assert(p.includes('2150 kcal'));
  assert(p.includes('Zostało: 850 kcal'));
  assert(p.includes('kolacja'));
  assert(p.includes('propose_recipe'));
});

Deno.test('sanityzacja przepisu: liczy kcal z makro, gdy się nie zgadza', () => {
  const r = sanitizeRecipe(
    {
      name: 'Kurczak z ryżem i papryką',
      slot: 'dinner',
      servings: 1,
      ingredients: [{ name: 'Pierś z kurczaka', grams: 150 }, { name: 'Ryż', grams: 60, household: '4 łyżki' }, { name: 'X', grams: 0 }],
      steps: ['Ugotuj ryż.', 'Usmaż kurczaka.'],
      per_serving: { kcal: 300, protein_g: 40, carbs_g: 50, fat_g: 10 },
    },
    null,
  );
  assert(r);
  assertEquals(r!.ingredients.length, 2);
  assertEquals(r!.per_serving.kcal, 450);
  assertEquals(r!.ingredients[1].household, '4 łyżki');
});

Deno.test('odrzuca przepis bez składników', () => {
  assertEquals(sanitizeRecipe({ name: 'X', ingredients: [], steps: ['a'], per_serving: { kcal: 100 } }, 'snack'), null);
});

Deno.test('parseReply rozdziela tekst i przepisy', () => {
  const out = parseReply(
    [
      { type: 'text', text: 'Mam dwie propozycje na kolację.' },
      {
        type: 'tool_use',
        name: 'propose_recipe',
        input: { name: 'Omlet', slot: 'dinner', servings: 1, ingredients: [{ name: 'Jajko', grams: 168 }], steps: ['Usmaż.'], per_serving: { kcal: 240, protein_g: 21, carbs_g: 1, fat_g: 16 } },
      },
    ],
    'dinner',
  );
  assertEquals(out.text, 'Mam dwie propozycje na kolację.');
  assertEquals(out.recipes.length, 1);
  assertEquals(out.recipes[0].name, 'Omlet');
});
