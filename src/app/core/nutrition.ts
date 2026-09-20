/**
 * Czyste funkcje obliczeń żywieniowych (bez Angulara i Supabase), łatwe do testowania.
 * Daty jako 'YYYY-MM-DD' w strefie Europe/Warsaw.
 */
import { Goal, Sex } from './database.types';

export const KCAL_PER_KG_FAT = 7700;
/** Maksymalna zmiana celu przy jednym comiesięcznym przeliczeniu. */
export const MAX_MONTHLY_CHANGE_KCAL = 250;

export const ACTIVITY_LEVELS: readonly { pal: number; label: string; hint: string }[] = [
  { pal: 1.2, label: 'Siedzący', hint: 'praca przy biurku, brak treningów' },
  { pal: 1.375, label: 'Lekka aktywność', hint: '1–3 treningi w tygodniu lub dużo chodzenia' },
  { pal: 1.55, label: 'Umiarkowana', hint: '3–5 treningów w tygodniu' },
  { pal: 1.725, label: 'Duża', hint: '6–7 treningów lub praca fizyczna' },
  { pal: 1.9, label: 'Bardzo duża', hint: 'ciężka praca fizyczna i treningi' },
];

export interface BodyParams {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  pal: number;
}

export interface TargetSettings {
  goal: Goal;
  /** tempo zmiany masy w % na tydzień */
  weeklyRatePct: number;
  proteinGPerKg: number;
  fatPct: number;
}

export interface Macros {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ComputedTarget extends Macros {
  bmr: number;
  tdee: number;
  /** dzienna korekta względem TDEE (ujemna = deficyt) */
  adjustment: number;
  /** true, jeśli cel podniesiono do bezpiecznego minimum */
  clampedToMinimum: boolean;
}

// ---------------------------------------------------------------------------
// Daty
// ---------------------------------------------------------------------------

/** Dzisiejsza data w Polsce jako 'YYYY-MM-DD'. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000);
}

export function ageOn(birthDateIso: string, onIso: string): number {
  const [by, bm, bd] = birthDateIso.split('-').map(Number);
  const [y, m, d] = onIso.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/**
 * Data kolejnego przeliczenia: dzień `recalcDay` w miesiącu następującym po miesiącu,
 * od którego obowiązuje ostatni cel. Jeśli do tej daty zostało mniej niż 14 dni
 * (np. cel ustawiony 20. dnia), przeliczenie przesuwa się o kolejny miesiąc.
 */
export function nextRecalcDate(lastValidFrom: string, recalcDay: number): string {
  const [y, m] = lastValidFrom.split('-').map(Number);
  let next = monthDay(y, m + 1, recalcDay);
  if (daysBetween(lastValidFrom, next) < 14) next = monthDay(y, m + 2, recalcDay);
  return next;
}

function monthDay(year: number, month: number, day: number): string {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((month - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Zapotrzebowanie
// ---------------------------------------------------------------------------

/** Mifflin-St Jeor. */
export function bmr(p: Pick<BodyParams, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(p.sex === 'male' ? base + 5 : base - 161);
}

export function tdee(p: BodyParams): number {
  return Math.round(bmr(p) * p.pal);
}

/** Dzienna korekta kcal wynikająca z celu i tempa (ujemna = deficyt). */
export function dailyAdjustment(goal: Goal, weeklyRatePct: number, weightKg: number): number {
  if (goal === 'maintain') return 0;
  const kgPerWeek = (weightKg * weeklyRatePct) / 100;
  const perDay = Math.round((kgPerWeek * KCAL_PER_KG_FAT) / 7);
  return goal === 'cut' ? -perDay : perDay;
}

/** Bezpieczne minimum: nie schodzimy poniżej BMR ani poniżej 1500/1200 kcal. */
export function minimumKcal(sex: Sex, bmrKcal: number): number {
  return Math.max(bmrKcal, sex === 'male' ? 1500 : 1200);
}

export function macrosFor(kcal: number, weightKg: number, s: Pick<TargetSettings, 'proteinGPerKg' | 'fatPct'>): Macros {
  const protein = Math.round(weightKg * s.proteinGPerKg);
  const fat = Math.round((kcal * s.fatPct) / 100 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein_g: protein, carbs_g: carbs, fat_g: fat };
}

/** Cel z wzoru; opcjonalnie z TDEE wyliczonym z danych (adaptacyjnie). */
export function computeTarget(body: BodyParams, settings: TargetSettings, measuredTdee?: number): ComputedTarget {
  const b = bmr(body);
  const t = measuredTdee ?? tdee(body);
  const adjustment = dailyAdjustment(settings.goal, settings.weeklyRatePct, body.weightKg);
  const min = minimumKcal(body.sex, b);
  const raw = t + adjustment;
  const kcal = roundTo(Math.max(raw, min), 10);
  return {
    ...macrosFor(kcal, body.weightKg, settings),
    bmr: b,
    tdee: t,
    adjustment,
    clampedToMinimum: raw < min,
  };
}

/** Ogranicza comiesięczną zmianę celu, żeby uniknąć skoków. */
export function limitMonthlyChange(previousKcal: number | null, nextKcal: number): number {
  if (previousKcal === null) return nextKcal;
  const diff = nextKcal - previousKcal;
  if (Math.abs(diff) <= MAX_MONTHLY_CHANGE_KCAL) return nextKcal;
  return previousKcal + Math.sign(diff) * MAX_MONTHLY_CHANGE_KCAL;
}

// ---------------------------------------------------------------------------
// Waga i trend
// ---------------------------------------------------------------------------

export interface WeightPoint {
  date: string;
  weight_kg: number;
}

/** Średnia z wpisów z okna [endIso - days + 1, endIso]; null gdy za mało pomiarów. */
export function windowAverage(entries: readonly WeightPoint[], endIso: string, days = 7, minEntries = 1): number | null {
  const start = addDays(endIso, -(days - 1));
  const w = entries.filter((e) => e.date >= start && e.date <= endIso);
  if (w.length < minEntries) return null;
  return w.reduce((s, e) => s + Number(e.weight_kg), 0) / w.length;
}

export type TrendStatus = 'collecting' | 'on_track' | 'too_slow' | 'too_fast' | 'wrong_direction';

export interface WeightTrend {
  /** średnia z ostatnich 7 dni */
  average: number | null;
  /** zmiana średniej tydzień do tygodnia w % */
  weeklyChangePct: number | null;
  weeklyChangeKg: number | null;
  status: TrendStatus;
}

/**
 * Porównuje średnią z ostatnich 7 dni ze średnią z 7 dni wcześniej.
 * Wymaga co najmniej 3 ważeń w każdym tygodniu (łącznie ~10 dni danych).
 */
export function weightTrend(entries: readonly WeightPoint[], todayIsoStr: string, goal: Goal, targetRatePct: number): WeightTrend {
  const average = windowAverage(entries, todayIsoStr, 7, 1);
  const now = windowAverage(entries, todayIsoStr, 7, 3);
  const prev = windowAverage(entries, addDays(todayIsoStr, -7), 7, 3);
  if (now === null || prev === null) {
    return { average, weeklyChangePct: null, weeklyChangeKg: null, status: 'collecting' };
  }
  const changeKg = now - prev;
  const pct = (changeKg / prev) * 100;
  return {
    average,
    weeklyChangePct: round2(pct),
    weeklyChangeKg: round2(changeKg),
    status: classifyTrend(pct, goal, targetRatePct),
  };
}

export function classifyTrend(weeklyPct: number, goal: Goal, targetRatePct: number): TrendStatus {
  if (goal === 'maintain') {
    return Math.abs(weeklyPct) <= 0.25 ? 'on_track' : weeklyPct < 0 ? 'too_fast' : 'wrong_direction';
  }
  // dla redukcji liczymy spadek jako wartość dodatnią
  const progress = goal === 'cut' ? -weeklyPct : weeklyPct;
  const low = Math.min(0.5, targetRatePct * 0.5);
  const high = Math.max(1, targetRatePct * 1.5);
  if (progress <= 0) return 'wrong_direction';
  if (progress < low) return 'too_slow';
  if (progress > high) return 'too_fast';
  return 'on_track';
}

// ---------------------------------------------------------------------------
// Adaptacyjne TDEE (z dziennika i zmiany wagi)
// ---------------------------------------------------------------------------

export interface IntakeDay {
  date: string;
  kcal: number;
}

/**
 * Rzeczywiste TDEE = średnie spożycie − zmiana zapasów energii / liczba dni.
 * Zwraca null, gdy danych jest za mało (min. 21 dni i 80% dni z wpisami w dzienniku).
 */
export function adaptiveTdee(intake: readonly IntakeDay[], weights: readonly WeightPoint[], endIso: string, days = 28): number | null {
  const start = addDays(endIso, -(days - 1));
  const logged = intake.filter((d) => d.date >= start && d.date <= endIso && d.kcal > 0);
  if (days < 21 || logged.length < days * 0.8) return null;
  const startAvg = windowAverage(weights, addDays(start, 6), 7, 3);
  const endAvg = windowAverage(weights, endIso, 7, 3);
  if (startAvg === null || endAvg === null) return null;
  const avgIntake = logged.reduce((s, d) => s + d.kcal, 0) / logged.length;
  // średnie tygodniowe są odległe o (days - 7) dni
  const span = days - 7;
  const estimate = avgIntake - ((endAvg - startAvg) * KCAL_PER_KG_FAT) / span;
  return Math.round(estimate);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
