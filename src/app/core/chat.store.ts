import { Injectable, inject, signal } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { ChatMessageRow, MealSlot } from './database.types';
import { todayIso } from './nutrition';
import { RecipeStore, RecipeSummary } from './recipe.store';

/** Przepis zaproponowany przez Claude (format z funkcji ai-chat). */
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recipes: ProposedRecipe[];
  created_at: string;
  pending?: boolean;
  error?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly db = inject(SupabaseService).client;
  private readonly recipes = inject(RecipeStore);

  readonly messages = signal<ChatMessage[]>([]);
  readonly loaded = signal(false);
  readonly sending = signal(false);
  /** przepisy z czatu zapisane w bazie: klucz karty (id wiadomości:indeks) -> przepis */
  readonly saved = signal<ReadonlyMap<string, RecipeSummary>>(new Map());

  async load(): Promise<void> {
    const { data, error } = await this.db.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    const messages = ((data ?? []) as ChatMessageRow[]).reverse().map(toMessage);
    this.messages.set(messages);
    this.loaded.set(true);
    // karty z historii łączymy z przepisami, które już są w bazie
    await this.recipes.load();
    const claude = new Map(this.recipes.recipes().filter((r) => r.origin === 'claude').map((r) => [r.name, r]));
    const next = new Map(this.saved());
    for (const m of messages) m.recipes.forEach((r, i) => claude.has(r.name) && next.set(cardKey(m.id, i), claude.get(r.name)!));
    this.saved.set(next);
  }

  /** Zwraca przepis z bazy dla karty; zapisuje go, jeśli jeszcze go tam nie ma. */
  async ensureSaved(key: string, r: ProposedRecipe): Promise<RecipeSummary> {
    const existing = this.saved().get(key);
    if (existing) return existing;
    const recipe = await this.recipes.createFromProposal(r);
    this.saved.update((m) => new Map(m).set(key, recipe));
    return recipe;
  }

  async send(text: string, slot: MealSlot | null): Promise<void> {
    const message = text.trim();
    if (!message || this.sending()) return;
    this.sending.set(true);
    const tempId = `tmp-${Date.now()}`;
    this.messages.update((l) => [
      ...l,
      { id: tempId, role: 'user', content: message, recipes: [], created_at: new Date().toISOString() },
      { id: `${tempId}-a`, role: 'assistant', content: '', recipes: [], created_at: new Date().toISOString(), pending: true },
    ]);
    try {
      const { data, error } = await this.db.functions.invoke<{ messages: ChatMessageRow[] }>('ai-chat', {
        body: { message, slot, date: todayIso() },
      });
      if (error) throw new Error(await functionError(error));
      const saved = (data?.messages ?? []).map(toMessage);
      this.messages.update((l) => [...l.filter((m) => !m.id.startsWith(tempId)), ...saved]);
      // każda propozycja od razu trafia do przepisów – Claude dostaje je potem jako „już proponowane”
      for (const m of saved) {
        for (const [i, r] of m.recipes.entries()) await this.ensureSaved(cardKey(m.id, i), r).catch(() => undefined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się połączyć z Claude.';
      this.messages.update((l) =>
        l.map((m) => (m.id === `${tempId}-a` ? { ...m, pending: false, error: true, content: msg } : m)),
      );
    } finally {
      this.sending.set(false);
    }
  }

  async clear(): Promise<void> {
    const { error } = await this.db.from('chat_messages').delete().gte('created_at', '1970-01-01');
    if (error) throw error;
    this.messages.set([]);
  }
}

export function cardKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

function toMessage(r: ChatMessageRow): ChatMessage {
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    recipes: Array.isArray(r.recipe) ? (r.recipe as unknown as ProposedRecipe[]) : [],
    created_at: r.created_at,
  };
}

/** Wyciąga czytelny komunikat z błędu funkcji (np. limit dzienny, brak środków). */
async function functionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null);
    if (body?.error) return String(body.error);
  }
  if (error instanceof Error && error.message) {
    if (/Failed to send|fetch/i.test(error.message)) return 'Brak połączenia z serwerem. Sprawdź internet.';
    return error.message;
  }
  return 'Nie udało się połączyć z Claude.';
}
