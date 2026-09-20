// Czysta logika czatu (bez sieci) – testowana w logic.test.ts.

export type MealSlot = 'breakfast' | 'snack' | 'lunch' | 'dinner';

export const SLOT_PL: Record<MealSlot, string> = {
  breakfast: 'śniadanie',
  snack: 'przekąska',
  lunch: 'obiad',
  dinner: 'kolacja',
};

export interface DayContext {
  date: string;
  goal: 'cut' | 'maintain' | 'gain';
  target: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  eaten: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  /** posiłki zjedzone dziś (nazwa, slot, kcal) */
  eatenItems: { slot: MealSlot; name: string; kcal: number }[];
  /** posiłki zaplanowane na dziś, jeszcze niezjedzone */
  planned: { slot: MealSlot; name: string; kcal: number }[];
  slotSplit: Record<MealSlot, number>;
}

export interface ProposedRecipe {
  name: string;
  slot: MealSlot;
  servings: number;
  prep_minutes: number | null;
  ingredients: { name: string; grams: number; household: string | null }[];
  steps: string[];
  per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  note: string | null;
}

/** Ile kcal zostało na wybrany posiłek (albo na resztę dnia). */
export function slotBudget(ctx: DayContext, slot: MealSlot | null): { remainingDay: number | null; slotTarget: number | null } {
  if (!ctx.target) return { remainingDay: null, slotTarget: null };
  const remainingDay = ctx.target.kcal - ctx.eaten.kcal;
  if (!slot) return { remainingDay, slotTarget: null };
  const total = Object.values(ctx.slotSplit).reduce((a, b) => a + b, 0) || 100;
  const planned = Math.round((ctx.target.kcal * ctx.slotSplit[slot]) / total);
  // nie proponujemy więcej, niż zostało na dziś (z zapasem na pozostałe zaplanowane posiłki)
  const reservedForOthers = ctx.planned.filter((p) => p.slot !== slot).reduce((s, p) => s + p.kcal, 0);
  const available = remainingDay - reservedForOthers;
  const slotTarget = Math.max(100, Math.min(planned, available > 150 ? available : planned));
  return { remainingDay, slotTarget };
}

export function systemPrompt(ctx: DayContext, slot: MealSlot | null): string {
  const { remainingDay, slotTarget } = slotBudget(ctx, slot);
  const t = ctx.target;
  const goal = { cut: 'redukcja masy ciała', maintain: 'utrzymanie wagi', gain: 'budowa masy' }[ctx.goal];
  const lines = [
    'Jesteś asystentem dietetycznym w prywatnej aplikacji MenuVibe. Rozmawiasz po polsku, krótko i konkretnie.',
    `Cel użytkownika: ${goal}.`,
    t
      ? `Dzienny cel: ${t.kcal} kcal (B ${t.protein_g} g, W ${t.carbs_g} g, T ${t.fat_g} g). Zjedzone dziś (${ctx.date}): ${ctx.eaten.kcal} kcal (B ${Math.round(ctx.eaten.protein_g)} g, W ${Math.round(ctx.eaten.carbs_g)} g, T ${Math.round(ctx.eaten.fat_g)} g). Zostało: ${remainingDay} kcal.`
      : 'Użytkownik nie ma jeszcze ustawionego celu kalorii.',
    ctx.eatenItems.length ? `Zjedzone posiłki: ${ctx.eatenItems.map((e) => `${SLOT_PL[e.slot]}: ${e.name} (${e.kcal} kcal)`).join('; ')}.` : '',
    ctx.planned.length ? `Zaplanowane na dziś (jeszcze niezjedzone): ${ctx.planned.map((p) => `${SLOT_PL[p.slot]}: ${p.name} (${p.kcal} kcal)`).join('; ')}.` : '',
    slot && slotTarget ? `Użytkownik pyta o posiłek: ${SLOT_PL[slot]}. Celuj w około ${slotTarget} kcal (±10%) na porcję.` : '',
    '',
    'Zasady propozycji:',
    '- Każdy przepis zwracaj narzędziem propose_recipe (1–3 propozycje), a w tekście tylko krótko je zapowiedz. Nie powtarzaj w tekście składników ani kroków.',
    '- Jeśli użytkownik poda składniki, które ma, opieraj przepis na nich; dodatki ogranicz do podstaw (przyprawy, oliwa, pieczywo).',
    '- Produkty dostępne w polskich sklepach (Lidl, Biedronka). Gramatury w gramach, surowe i przed obróbką, miara domowa w nawiasie.',
    '- Makroskładniki licz rzetelnie z typowych tabel wartości odżywczych; kcal ≈ 4·B + 4·W + 9·T. Wartości podawaj na 1 porcję.',
    '- Przy redukcji stawiaj na dużo białka i warzyw. Proste kroki, najwyżej 6.',
    '- Nie dawaj porad medycznych; przy chorobach odsyłaj do dietetyczki lub lekarza. Nie proponuj schodzenia poniżej celu kalorii.',
    '- Na pytania niezwiązane z jedzeniem odpowiadaj krótko, że pomagasz w diecie.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export const RECIPE_TOOL = {
  name: 'propose_recipe',
  description: 'Propozycja przepisu, którą użytkownik może zapisać w aplikacji lub dodać do dziennika.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Krótka nazwa dania po polsku' },
      slot: { type: 'string', enum: ['breakfast', 'snack', 'lunch', 'dinner'] },
      servings: { type: 'integer', minimum: 1, maximum: 6, description: 'Na ile porcji są składniki' },
      prep_minutes: { type: 'integer', minimum: 1, maximum: 240 },
      ingredients: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            grams: { type: 'number', description: 'Ilość na cały przepis w gramach' },
            household: { type: 'string', description: 'Miara domowa, np. „2 łyżki”' },
          },
          required: ['name', 'grams'],
        },
      },
      steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
      per_serving: {
        type: 'object',
        properties: {
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
        },
        required: ['kcal', 'protein_g', 'carbs_g', 'fat_g'],
      },
      note: { type: 'string', description: 'Opcjonalna krótka uwaga, np. zamiennik' },
    },
    required: ['name', 'slot', 'servings', 'ingredients', 'steps', 'per_serving'],
  },
} as const;

/** Waliduje i porządkuje przepis z narzędzia; null, jeśli jest bezużyteczny. */
export function sanitizeRecipe(input: unknown, fallbackSlot: MealSlot | null): ProposedRecipe | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const slots: MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];
  const slot = slots.includes(r['slot'] as MealSlot) ? (r['slot'] as MealSlot) : fallbackSlot ?? 'lunch';
  const ingredients = (Array.isArray(r['ingredients']) ? r['ingredients'] : [])
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i['name'] === 'string' && Number(i['grams']) > 0)
    .map((i) => ({
      name: String(i['name']).trim(),
      grams: Math.round(Number(i['grams']) * 10) / 10,
      household: typeof i['household'] === 'string' && i['household'].trim() ? String(i['household']).trim() : null,
    }));
  const steps = (Array.isArray(r['steps']) ? r['steps'] : []).filter((s) => typeof s === 'string' && s.trim()).map((s) => String(s).trim());
  const ps = (r['per_serving'] ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Math.max(0, Math.round(Number(v) * 10) / 10 || 0);
  const per = { kcal: Math.round(n(ps['kcal'])), protein_g: n(ps['protein_g']), carbs_g: n(ps['carbs_g']), fat_g: n(ps['fat_g']) };
  // gdy kcal nie podano albo odbiega mocno od makro – liczymy z makro
  const fromMacros = Math.round(per.protein_g * 4 + per.carbs_g * 4 + per.fat_g * 9);
  if (!per.kcal || (fromMacros > 0 && Math.abs(per.kcal - fromMacros) / fromMacros > 0.15)) per.kcal = fromMacros;
  const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
  if (!name || !ingredients.length || !steps.length || per.kcal <= 0) return null;
  return {
    name,
    slot,
    servings: Math.min(6, Math.max(1, Math.round(Number(r['servings']) || 1))),
    prep_minutes: Number(r['prep_minutes']) > 0 ? Math.round(Number(r['prep_minutes'])) : null,
    ingredients,
    steps,
    per_serving: per,
    note: typeof r['note'] === 'string' && r['note'].trim() ? r['note'].trim() : null,
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/** Rozbija odpowiedź Claude na tekst i przepisy. */
export function parseReply(content: ContentBlock[], fallbackSlot: MealSlot | null): { text: string; recipes: ProposedRecipe[] } {
  const text = content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!.trim())
    .join('\n\n')
    .trim();
  const recipes = content
    .filter((b) => b.type === 'tool_use' && b.name === RECIPE_TOOL.name)
    .map((b) => sanitizeRecipe(b.input, fallbackSlot))
    .filter((r): r is ProposedRecipe => r !== null);
  return { text: text || (recipes.length ? 'Oto propozycje:' : 'Nie udało się przygotować odpowiedzi.'), recipes };
}
