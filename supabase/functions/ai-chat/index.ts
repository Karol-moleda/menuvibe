// Edge Function „ai-chat”: pośrednik między aplikacją a Claude API.
// Klucz ANTHROPIC_API_KEY jest tylko tutaj (sekret Supabase), nigdy w aplikacji.
//
// Wdrożenie:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy ai-chat
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DayContext, MealSlot, RECIPE_TOOL, parseReply, systemPrompt } from './logic.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';
const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '40');
const HISTORY = 12;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Brak klucza ANTHROPIC_API_KEY w sekretach funkcji.' }, 500);

  // klient działający w imieniu zalogowanego użytkownika – RLS pilnuje dostępu do danych
  const auth = req.headers.get('Authorization') ?? '';
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, publicKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (userError || !userData.user) return json({ error: 'Nie jesteś zalogowany.' }, 401);

  let body: { message?: string; slot?: MealSlot | null; date?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Nieprawidłowe zapytanie.' }, 400);
  }
  const message = (body.message ?? '').trim().slice(0, 2000);
  const slot = (['breakfast', 'snack', 'lunch', 'dinner'] as const).includes(body.slot as MealSlot) ? (body.slot as MealSlot) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') ? body.date! : new Date().toISOString().slice(0, 10);
  if (!message) return json({ error: 'Pusta wiadomość.' }, 400);

  // dzienny limit zapytań
  const usage = await db.rpc('ai_usage_register', { p_date: date, p_limit: DAILY_LIMIT });
  if (usage.error) {
    const limited = usage.error.message.includes('MENUVIBE_AI_LIMIT');
    return json({ error: limited ? `Dzienny limit ${DAILY_LIMIT} pytań wyczerpany. Wróć jutro.` : usage.error.message }, limited ? 429 : 500);
  }

  const ctx = await loadContext(db, date);
  const history = await db.from('chat_messages').select('role,content').order('created_at', { ascending: false }).limit(HISTORY);
  const messages = [
    ...((history.data ?? []) as { role: 'user' | 'assistant'; content: string }[]).reverse(),
    { role: 'user' as const, content: message },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2500,
      system: systemPrompt(ctx, slot),
      tools: [RECIPE_TOOL],
      messages,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const detail = data?.error?.message ?? res.statusText;
    const hint =
      res.status === 401 ? 'Nieprawidłowy klucz API.' :
      res.status === 404 ? `Model ${MODEL} jest niedostępny – ustaw sekret ANTHROPIC_MODEL.` :
      res.status === 429 ? 'Za dużo zapytań do Claude, spróbuj za chwilę.' :
      res.status === 400 && /credit/i.test(detail) ? 'Brak środków na koncie Anthropic.' :
      'Claude nie odpowiedział.';
    return json({ error: `${hint} (${res.status}: ${detail})` }, 502);
  }

  const reply = parseReply(data.content ?? [], slot);
  await db.rpc('ai_usage_add_tokens', {
    p_date: date,
    p_input: data.usage?.input_tokens ?? 0,
    p_output: data.usage?.output_tokens ?? 0,
  });

  // zapis rozmowy osobno, żeby kolejność (created_at) była jednoznaczna;
  // przepisy trzymamy przy wiadomości, żeby dało się je zapisać później
  const userMsg = await db.from('chat_messages').insert({ role: 'user', content: message }).select('*').single();
  const botMsg = await db
    .from('chat_messages')
    .insert({ role: 'assistant', content: reply.text, recipe: reply.recipes.length ? reply.recipes : null })
    .select('*')
    .single();

  return json({ text: reply.text, recipes: reply.recipes, messages: [userMsg.data, botMsg.data].filter(Boolean), usage: usage.data });
});

// deno-lint-ignore no-explicit-any
async function loadContext(db: any, date: string): Promise<DayContext> {
  const [profile, targets, diary, planned, previous] = await Promise.all([
    db.from('profiles').select('goal,slot_split').maybeSingle(),
    db.from('calorie_targets').select('kcal,protein_g,carbs_g,fat_g,valid_from').lte('valid_from', date).order('valid_from', { ascending: false }).limit(1),
    db.from('diary_entries').select('slot,name,kcal,protein_g,carbs_g,fat_g,recipe_id').eq('date', date),
    db.from('meal_plan_items').select('slot,portion_factor,recipe_id,recipes(name,kcal)').eq('date', date),
    db.from('recipes').select('name').eq('origin', 'claude').order('created_at', { ascending: false }).limit(80),
  ]);
  const entries = (diary.data ?? []) as { slot: MealSlot; name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; recipe_id: string | null }[];
  const eaten = entries.reduce(
    (t, e) => ({ kcal: t.kcal + e.kcal, protein_g: t.protein_g + Number(e.protein_g), carbs_g: t.carbs_g + Number(e.carbs_g), fat_g: t.fat_g + Number(e.fat_g) }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const split = profile.data?.slot_split;
  const eatenRecipeIds = new Set(entries.map((e) => e.recipe_id).filter(Boolean));
  return {
    date,
    goal: profile.data?.goal ?? 'cut',
    target: targets.data?.[0] ?? null,
    eaten,
    eatenItems: entries.map((e) => ({ slot: e.slot, name: e.name, kcal: e.kcal })),
    planned: ((planned.data ?? []) as { slot: MealSlot; portion_factor: number; recipe_id: string; recipes: { name: string; kcal: number } | null }[])
      .filter((p) => p.recipes && !eatenRecipeIds.has(p.recipe_id))
      .map((p) => ({ slot: p.slot, name: p.recipes!.name, kcal: Math.round(p.recipes!.kcal * Number(p.portion_factor)) })),
    slotSplit: split && typeof split.breakfast === 'number' ? split : { breakfast: 30, snack: 10, lunch: 30, dinner: 30 },
    previous: [...new Set(((previous.data ?? []) as { name: string }[]).map((r) => r.name))],
  };
}
