import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth.service';
import { CalorieTargetRow, ProfileRow, WeightEntryRow } from './database.types';
import {
  ComputedTarget,
  TargetSettings,
  ActivityProfile,
  MeasuredTdee,
  ageOn,
  blendTdee,
  computeTarget,
  estimateTdee,
  limitWeeklyChange,
  macrosFor,
  measureTdee,
  nextRecalcDate,
  todayIso,
  weightTrend,
  windowAverage,
} from './nutrition';

export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | 'display_name' | 'sex' | 'birth_date' | 'height_cm' | 'activity_pal' | 'body_fat_pct'
    | 'job_pal' | 'daily_steps' | 'training_days' | 'training_minutes' | 'training_met'
    | 'goal' | 'weekly_rate_pct' | 'protein_g_per_kg' | 'fat_pct' | 'water_goal_ml' | 'recalc_weekday'
  >
>;

export interface RecalcResult {
  target: CalorieTargetRow;
  previousKcal: number | null;
}

/**
 * Profil, ważenia i cele kalorii. Jedno źródło prawdy dla ekranów Profil i Dziś.
 */
@Injectable({ providedIn: 'root' })
export class BodyStore {
  private readonly db = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  readonly profile = signal<ProfileRow | null>(null);
  readonly weights = signal<WeightEntryRow[]>([]);
  readonly targets = signal<CalorieTargetRow[]>([]);
  readonly loaded = signal(false);
  readonly today = signal(todayIso());

  /** Cel obowiązujący dziś (najnowszy z valid_from <= dziś). */
  readonly currentTarget = computed(() => {
    const t = this.today();
    return this.targets().find((x) => x.valid_from <= t) ?? null;
  });

  readonly latestWeight = computed(() => this.weights()[0] ?? null);

  /** Waga do obliczeń: średnia z 7 dni, a gdy jej brak – ostatni pomiar. */
  readonly referenceWeight = computed(() => {
    const avg = windowAverage(this.weights(), this.today(), 7, 1);
    return avg ?? (this.latestWeight() ? Number(this.latestWeight()!.weight_kg) : null);
  });

  readonly missingFields = computed(() => {
    const p = this.profile();
    const missing: string[] = [];
    if (!p?.sex) missing.push('płeć');
    if (!p?.birth_date) missing.push('data urodzenia');
    if (!p?.height_cm) missing.push('wzrost');
    if (!p?.activity_pal) missing.push('aktywność');
    if (!this.latestWeight()) missing.push('waga');
    return missing;
  });

  readonly profileComplete = computed(() => this.missingFields().length === 0);

  readonly trend = computed(() => {
    const p = this.profile();
    return weightTrend(this.weights(), this.today(), p?.goal ?? 'cut', Number(p?.weekly_rate_pct ?? 0.5));
  });

  /** Zmierzone zapotrzebowanie z dziennika i wagi (odświeżane przy wczytaniu). */
  readonly measured = signal<MeasuredTdee | null>(null);

  /** Zapotrzebowanie „na żywo”: wzór + korekta z Twoich danych. */
  readonly energy = computed(() => {
    const body = this.bodyParams();
    if (!body) return null;
    const estimate = estimateTdee(body);
    const blended = blendTdee(estimate.tdee, this.measured());
    return { estimate, measured: this.measured(), ...blended };
  });

  /** Podgląd celu z aktualnych danych (bez zapisu). */
  readonly formulaPreview = computed<ComputedTarget | null>(() => {
    const p = this.profile();
    const w = this.referenceWeight();
    if (!this.profileComplete() || !p || w === null) return null;
    return computeTarget(this.bodyParams()!, this.settings(p), this.energy()?.tdee);
  });

  /** Parametry ciała do wzorów; null, gdy profil jest niekompletny. */
  readonly bodyParams = computed(() => {
    const p = this.profile();
    const w = this.referenceWeight();
    if (!p || w === null || !this.profileComplete()) return null;
    return {
      sex: p.sex!,
      age: ageOn(p.birth_date!, this.today()),
      heightCm: Number(p.height_cm),
      weightKg: w,
      bodyFatPct: p.body_fat_pct === null ? null : Number(p.body_fat_pct),
      activity: this.activity(p),
    };
  });

  readonly nextRecalc = computed(() => {
    const t = this.currentTarget();
    const p = this.profile();
    if (!t || !p) return null;
    return nextRecalcDate(t.valid_from, p.recalc_weekday);
  });

  reset(): void {
    this.profile.set(null);
    this.weights.set([]);
    this.targets.set([]);
    this.loaded.set(false);
  }

  async load(): Promise<void> {
    this.today.set(todayIso());
    const [profile, weights, targets] = await Promise.all([
      this.db.from('profiles').select('*').maybeSingle(),
      this.db.from('weight_entries').select('*').order('date', { ascending: false }).limit(400),
      this.db.from('calorie_targets').select('*').order('valid_from', { ascending: false }).limit(60),
    ]);
    for (const r of [profile, weights, targets]) if (r.error) throw r.error;

    let p = profile.data as ProfileRow | null;
    if (!p) {
      // profil tworzy trigger przy rejestracji; to zabezpieczenie na wypadek starszego konta
      const created = await this.db.from('profiles').insert({} as never).select('*').single();
      if (created.error) throw created.error;
      p = created.data as ProfileRow;
    }
    this.profile.set(p);
    this.weights.set((weights.data ?? []) as WeightEntryRow[]);
    this.targets.set((targets.data ?? []) as CalorieTargetRow[]);
    this.loaded.set(true);
    await this.refreshMeasured();
  }

  async saveProfile(update: ProfileUpdate): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Brak zalogowanego użytkownika');
    const { data, error } = await this.db.from('profiles').update(update).eq('user_id', userId).select('*').single();
    if (error) throw error;
    this.profile.set(data as ProfileRow);
  }

  async addWeight(weightKg: number, date = this.today()): Promise<void> {
    const { data, error } = await this.db
      .from('weight_entries')
      .upsert({ date, weight_kg: weightKg }, { onConflict: 'user_id,date' })
      .select('*')
      .single();
    if (error) throw error;
    const row = data as WeightEntryRow;
    this.weights.update((list) =>
      [row, ...list.filter((w) => w.date !== row.date)].sort((a, b) => b.date.localeCompare(a.date)),
    );
  }

  async deleteWeight(id: string): Promise<void> {
    const { error } = await this.db.from('weight_entries').delete().eq('id', id);
    if (error) throw error;
    this.weights.update((list) => list.filter((w) => w.id !== id));
  }

  /**
   * Przelicza cel, jeśli nadszedł dzień cotygodniowego przeliczenia (albo celu jeszcze nie ma).
   * Cel ustawiony ręcznie (od dietetyczki) nie jest nadpisywany automatycznie.
   */
  async ensureWeeklyTarget(): Promise<RecalcResult | null> {
    if (!this.profileComplete()) return null;
    const current = this.currentTarget();
    if (current?.method === 'manual') return null;
    const due = !current || this.today() >= nextRecalcDate(current.valid_from, this.profile()!.recalc_weekday);
    return due ? this.recalculate({ automatic: true }) : null;
  }

  /**
   * Liczy nowy cel od dziś (wzór albo TDEE zmierzone z dziennika) i zapisuje go w historii.
   * Przy automatycznym przeliczeniu zmiana jest ograniczona do 250 kcal; ręczne „Przelicz teraz” liczy bez limitu.
   */
  async recalculate(opts: { automatic?: boolean } = {}): Promise<RecalcResult> {
    const p = this.profile();
    const w = this.referenceWeight();
    const body = this.bodyParams();
    if (!p || !body || w === null) throw new Error('Uzupełnij profil i dodaj wagę.');
    const today = this.today();

    await this.refreshMeasured();
    const energy = this.energy()!;
    const computed = computeTarget(body, this.settings(p), energy.tdee);

    const previous = this.currentTarget();
    const previousKcal = opts.automatic && previous && previous.method !== 'manual' ? previous.kcal : null;
    const kcal = limitWeeklyChange(previousKcal, computed.kcal);
    const macros = macrosFor(kcal, w, this.settings(p));

    const m = energy.measured;
    const notes: string[] = [
      m
        ? `Zapotrzebowanie z Twoich danych: ${m.tdee} kcal (${m.loggedDays} dni dziennika, ${m.weighIns} ważeń), ze wzoru: ${energy.estimate.tdee} kcal`
        : `Zapotrzebowanie ze wzoru: ${energy.estimate.tdee} kcal`,
    ];
    if (computed.clampedDeficit) notes.push('deficyt przycięty do 25% zapotrzebowania');
    if (computed.clampedToMinimum) notes.push('podniesiono do bezpiecznego minimum');
    if (kcal !== computed.kcal) notes.push(`zmiana ograniczona (wyliczone ${computed.kcal})`);

    return this.saveTarget({
      valid_from: today,
      ...macros,
      method: energy.used === 'blend' ? 'adaptive' : 'formula',
      bmr: computed.bmr,
      tdee: energy.tdee,
      measured_tdee: m?.tdee ?? null,
      confidence: energy.confidence,
      weight_kg: Math.round(w * 100) / 100,
      note: notes.join('; '),
    }, previous?.kcal ?? null);
  }

  /** Cel podany ręcznie (np. od dietetyczki); makro liczone z ustawień, jeśli nie podano. */
  async setManualTarget(kcal: number, macros?: Partial<Pick<CalorieTargetRow, 'protein_g' | 'carbs_g' | 'fat_g'>>): Promise<RecalcResult> {
    const p = this.profile();
    const w = this.referenceWeight() ?? 80;
    const base = macrosFor(kcal, w, this.settings(p!));
    return this.saveTarget({
      valid_from: this.today(),
      kcal,
      protein_g: macros?.protein_g ?? base.protein_g,
      carbs_g: macros?.carbs_g ?? base.carbs_g,
      fat_g: macros?.fat_g ?? base.fat_g,
      method: 'manual',
      bmr: null,
      tdee: null,
      measured_tdee: null,
      confidence: null,
      weight_kg: this.referenceWeight(),
      note: 'Cel ustawiony ręcznie',
    }, this.currentTarget()?.kcal ?? null);
  }

  private async saveTarget(
    row: Omit<CalorieTargetRow, 'id' | 'user_id' | 'created_at'>,
    previousKcal: number | null,
  ): Promise<RecalcResult> {
    const { data, error } = await this.db
      .from('calorie_targets')
      .upsert(row, { onConflict: 'user_id,valid_from' })
      .select('*')
      .single();
    if (error) throw error;
    const saved = data as CalorieTargetRow;
    this.targets.update((list) =>
      [saved, ...list.filter((t) => t.valid_from !== saved.valid_from)].sort((a, b) => b.valid_from.localeCompare(a.valid_from)),
    );
    return { target: saved, previousKcal };
  }

  /** Odświeża zmierzone zapotrzebowanie z ostatnich 28 dni dziennika i ważeń. */
  async refreshMeasured(): Promise<void> {
    const end = this.today();
    const start = new Date(Date.parse(`${end}T12:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await this.db.from('diary_entries').select('date,kcal').gte('date', start).lte('date', end);
    if (error || !data?.length) {
      this.measured.set(null);
      return;
    }
    const perDay = new Map<string, number>();
    for (const r of data as { date: string; kcal: number }[]) perDay.set(r.date, (perDay.get(r.date) ?? 0) + r.kcal);
    const intake = [...perDay].map(([date, kcal]) => ({ date, kcal }));
    this.measured.set(measureTdee(intake, this.weights(), end));
  }

  private activity(p: ProfileRow): ActivityProfile {
    return {
      jobPal: Number(p.job_pal),
      dailySteps: p.daily_steps,
      trainingDays: p.training_days,
      trainingMinutes: p.training_minutes,
      trainingMet: Number(p.training_met),
    };
  }

  private settings(p: ProfileRow): TargetSettings {
    return {
      goal: p.goal,
      weeklyRatePct: Number(p.weekly_rate_pct),
      proteinGPerKg: Number(p.protein_g_per_kg),
      fatPct: Number(p.fat_pct),
    };
  }
}
