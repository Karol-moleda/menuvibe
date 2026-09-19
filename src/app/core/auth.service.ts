import { Injectable, computed, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;

  private readonly _session = signal<Session | null>(null);
  private readonly ready: Promise<void>;

  readonly session = this._session.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  readonly isLoggedIn = computed(() => this._session() !== null);

  constructor() {
    this.ready = this.supabase.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
    });
    this.supabase.auth.onAuthStateChange((_event, session) => this._session.set(session));
  }

  /** Czeka, aż sesja zostanie odczytana z pamięci telefonu. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  async signIn(email: string, password: string): Promise<string | null> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    return error ? translateAuthError(error.message) : null;
  }

  /**
   * Zakłada konto. Baza przyjmuje tylko pierwsze konto (właściciela) i od razu je potwierdza,
   * więc po rejestracji logujemy się bez klikania linku z e-maila.
   */
  async signUp(email: string, password: string): Promise<string | null> {
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) return translateAuthError(error.message);
    if (data.session) return null;
    return this.signIn(email, password);
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }
}

export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło.';
  if (m.includes('email not confirmed')) return 'Konto nie zostało potwierdzone. Potwierdź je w panelu Supabase.';
  if (m.includes('fetch') || m.includes('network')) return 'Brak połączenia z serwerem. Sprawdź internet.';
  if (m.includes('database error saving new user') || m.includes('menuvibe_signup_closed'))
    return 'Konto właściciela już istnieje. Zaloguj się.';
  if (m.includes('user already registered')) return 'To konto już istnieje. Zaloguj się.';
  if (m.includes('password should be')) return 'Hasło jest za słabe – użyj co najmniej 8 znaków.';
  if (m.includes('rate limit')) return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.';
  return message;
}
