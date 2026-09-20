import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { ActivityEntryRow } from './database.types';
import { BodyStore } from './body.store';
import { DayActivity, addDays, averageActivity, todayIso } from './nutrition';

/** Typy treningu z METami – ten sam zestaw, co w profilu, plus kilka popularnych. */
export const SPORTS: readonly { key: string; label: string; met: number }[] = [
  { key: 'gym', label: 'Siłownia', met: 5 },
  { key: 'run', label: 'Bieganie', met: 9 },
  { key: 'walk', label: 'Marsz', met: 3.5 },
  { key: 'bike', label: 'Rower', met: 7 },
  { key: 'swim', label: 'Pływanie', met: 7 },
  { key: 'classes', label: 'Zajęcia / interwały', met: 7.5 },
  { key: 'other', label: 'Inne', met: 5 },
];

/** Energia treningu netto (bez przemiany spoczynkowej): (MET − 1) × 3,5 × kg / 200 × minuty. */
export function workoutKcal(met: number, minutes: number, weightKg: number): number {
  return Math.round(((met - 1) * 3.5 * weightKg * minutes) / 200);
}

/** Kroki i treningi z ostatnich tygodni. */
@Injectable({ providedIn: 'root' })
export class ActivityStore {
  private readonly db = inject(SupabaseService).client;
  private readonly body = inject(BodyStore);

  readonly entries = signal<ActivityEntryRow[]>([]);
  readonly loaded = signal(false);
  readonly date = signal(todayIso());

  /** Dane dzienne gotowe do wyliczeń (kroki + suma kcal treningów). */
  readonly byDay = computed<DayActivity[]>(() => {
    const map = new Map<string, DayActivity>();
    for (const e of this.entries()) {
      const day = map.get(e.date) ?? { date: e.date, steps: 0, workoutKcal: 0 };
      if (e.kind === 'steps') day.steps = e.steps ?? 0;
      else day.workoutKcal += e.kcal ?? 0;
      map.set(e.date, day);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  });

  readonly today = computed(() => this.byDay().find((d) => d.date === this.date()) ?? { date: this.date(), steps: 0, workoutKcal: 0 });
  readonly todayWorkouts = computed(() => this.entries().filter((e) => e.date === this.date() && e.kind === 'workout'));

  /** Wczytuje ostatnie 28 dni. */
  async load(end = todayIso()): Promise<void> {
    this.date.set(end);
    const { data, error } = await this.db
      .from('activity_entries')
      .select('*')
      .gte('date', addDays(end, -27))
      .lte('date', end)
      .order('date', { ascending: false });
    if (error) throw error;
    this.entries.set((data ?? []) as ActivityEntryRow[]);
    this.loaded.set(true);
    this.publish();
  }

  /** Przekazuje średni ruch do wyliczeń zapotrzebowania. */
  private publish(): void {
    const w = this.body.referenceWeight();
    if (w === null) return;
    this.body.activityMeasured.set(averageActivity(this.byDay(), w, this.date()));
  }

  async setSteps(steps: number, date = this.date()): Promise<void> {
    const existing = this.entries().find((e) => e.date === date && e.kind === 'steps');
    const q = existing
      ? this.db.from('activity_entries').update({ steps }).eq('id', existing.id)
      : this.db.from('activity_entries').insert({ date, kind: 'steps', steps, source: 'manual' });
    const { data, error } = await q.select('*').single();
    if (error) throw error;
    const row = data as ActivityEntryRow;
    this.entries.update((l) => [row, ...l.filter((e) => !(e.date === date && e.kind === 'steps'))]);
    this.publish();
  }

  async addWorkout(input: { sport: string; minutes: number; kcal: number; date?: string; note?: string | null }): Promise<void> {
    const { data, error } = await this.db
      .from('activity_entries')
      .insert({
        date: input.date ?? this.date(),
        kind: 'workout',
        sport: input.sport,
        minutes: input.minutes,
        kcal: input.kcal,
        note: input.note ?? null,
        source: 'manual',
      })
      .select('*')
      .single();
    if (error) throw error;
    this.entries.update((l) => [data as ActivityEntryRow, ...l]);
    this.publish();
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('activity_entries').delete().eq('id', id);
    if (error) throw error;
    this.entries.update((l) => l.filter((e) => e.id !== id));
    this.publish();
  }
}
