/**
 * Czyste funkcje obliczeń żywieniowych (bez Angulara i Supabase), łatwe do testowania.
 * Daty jako 'YYYY-MM-DD' w strefie Europe/Warsaw.
 */
import { Goal, Sex } from './database.types';

export const KCAL_PER_KG_FAT = 7700;
/** Maksymalna zmiana celu przy jednym (tygodniowym) przeliczeniu. */
export const MAX_WEEKLY_CHANGE_KCAL = 100;
/** …i nie więcej niż tyle procent poprzedniego celu. */
export const MAX_WEEKLY_CHANGE_PCT = 10;
/** Deficyt nie większy niż tyle procent zapotrzebowania. */
export const MAX_DEFICIT_PCT = 25;
/** Kroki wliczone już w tryb dnia (PAL pracy) – dopiero powyżej doliczamy energię. */
export const BASELINE_STEPS = 2500;
/** Chodzenie: ok. 0,45 kcal na 1000 kroków na każdy kilogram masy ciała. */
export const KCAL_PER_1000_STEPS_PER_KG = 0.45;

/** Tryb dnia poza treningami (NEAT). Mnożniki wg FAO/WHO/UNU dla pracy siedzącej i fizycznej. */
export const JOB_LEVELS: readonly { pal: number; label: string; hint: string }[] = [
  { pal: 1.15, label: 'Praca siedząca', hint: 'biuro, samochód, mało chodzenia' },
  { pal: 1.25, label: 'Praca mieszana', hint: 'sporo chodzenia i stania w ciągu dnia' },
  { pal: 1.4, label: 'Praca fizyczna', hint: 'cały dzień na nogach, dźwiganie' },
];

/** Intensywność treningu w METach (Compendium of Physical Activities). */
export const TRAINING_INTENSITIES: readonly { met: number; label: string; hint: string }[] = [
  { met: 3.5, label: 'Lekki', hint: 'marsz, joga, spokojna rowerowa' },
  { met: 6, label: 'Średni', hint: 'siłownia, trucht, rower 18 km/h' },
  { met: 8.5, label: 'Mocny', hint: 'bieganie, interwały, ciężki trening' },
];

export interface ActivityProfile {
  /** mnożnik trybu dnia poza treningami */
  jobPal: number;
  /** przeciętna liczba kroków dziennie */
  dailySteps: number;
  /** liczba treningów w tygodniu */
  trainingDays: number;
  /** długość jednego treningu w minutach */
  trainingMinutes: number;
  /** intensywność treningu w METach */
  trainingMet: number;
}

export const DEFAULT_ACTIVITY: ActivityProfile = {
  jobPal: 1.15,
  dailySteps: 6000,
  trainingDays: 3,
  trainingMinutes: 60,
  trainingMet: 6,
};

export interface BodyParams {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityProfile;
  /** procent tkanki tłuszczowej, jeśli znany (wtedy wzór Katch-McArdle) */
  bodyFatPct?: number | null;
}

export interface DayActivity {
  date: string;
  /** kroki z zegarka albo wpisane ręcznie */
  steps: number;
  /** energia treningów netto w kcal */
  workoutKcal: number;
}

export interface MeasuredActivity {
  stepsKcal: number;
  trainingKcal: number;
  /** liczba dni z danymi w oknie */
  days: number;
  avgSteps: number;
}

export interface EnergyEstimate {
  bmr: number;
  /** energia trybu dnia: BMR × PAL pracy */
  baseKcal: number;
  stepsKcal: number;
  trainingKcal: number;
  tdee: number;
  /** wynikowy PAL = TDEE / BMR */
  pal: number;
  /** skąd wzięliśmy kroki i treningi */
  source: 'declared' | 'measured';
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
  /** zapotrzebowanie użyte do wyliczenia celu (zmierzone albo ze wzoru) */
  tdee: number;
  /** rozbicie zapotrzebowania ze wzoru */
  estimate: EnergyEstimate;
  /** dzienna korekta względem TDEE (ujemna = deficyt) */
  adjustment: number;
  /** true, jeśli cel podniesiono do bezpiecznego minimum */
  clampedToMinimum: boolean;
  /** true, jeśli deficyt przycięto do 25% zapotrzebowania */
  clampedDeficit: boolean;
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
 * Data kolejnego przeliczenia: najbliższy dzień tygodnia `weekday` (1 = poniedziałek)
 * przypadający co najmniej 7 dni po `lastValidFrom`.
 */
export function nextRecalcDate(lastValidFrom: string, weekday: number): string {
  let next = addDays(lastValidFrom, 7);
  for (let i = 0; i < 7 && weekdayOf(next) !== weekday; i++) next = addDays(next, 1);
  return next;
}

/** Dzień tygodnia: 1 = poniedziałek … 7 = niedziela. */
export function weekdayOf(iso: string): number {
  return ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

// ---------------------------------------------------------------------------
// Zapotrzebowanie
// ---------------------------------------------------------------------------

/**
 * Spoczynkowa przemiana materii. Domyślnie Mifflin-St Jeor (najdokładniejszy wzór
 * dla osób bez otyłości – ok. 82% wyników mieści się w ±10% pomiaru). Gdy znany jest
 * procent tkanki tłuszczowej, liczymy z masy beztłuszczowej wzorem Katch-McArdle.
 */
export function bmr(p: Pick<BodyParams, 'sex' | 'age' | 'heightCm' | 'weightKg' | 'bodyFatPct'>): number {
  if (p.bodyFatPct != null && p.bodyFatPct >= 3 && p.bodyFatPct <= 60) {
    const lean = p.weightKg * (1 - p.bodyFatPct / 100);
    return Math.round(370 + 21.6 * lean);
  }
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(p.sex === 'male' ? base + 5 : base - 161);
}

/** Energia chodzenia ponad to, co mieści się już w trybie dnia. */
export function stepsKcal(dailySteps: number, weightKg: number): number {
  const extra = Math.max(0, dailySteps - BASELINE_STEPS);
  return Math.round((extra / 1000) * KCAL_PER_1000_STEPS_PER_KG * weightKg);
}

/**
 * Energia treningów rozłożona na dzień. Liczymy netto (MET − 1), bo energia spoczynkowa
 * jest już w BMR – inaczej policzylibyśmy ją dwa razy.
 */
export function trainingKcal(a: ActivityProfile, weightKg: number): number {
  const perSession = ((a.trainingMet - 1) * 3.5 * weightKg * a.trainingMinutes) / 200;
  return Math.round((perSession * a.trainingDays) / 7);
}

/** Zapotrzebowanie ze wzoru: tryb dnia + kroki + treningi. */
export function estimateTdee(p: BodyParams): EnergyEstimate {
  const b = bmr(p);
  const base = Math.round(b * p.activity.jobPal);
  const steps = stepsKcal(p.activity.dailySteps, p.weightKg);
  const training = trainingKcal(p.activity, p.weightKg);
  const total = base + steps + training;
  return { bmr: b, baseKcal: base, stepsKcal: steps, trainingKcal: training, tdee: total, pal: Math.round((total / b) * 100) / 100, source: 'declared' };
}

/**
 * Średni ruch z ostatnich dni (kroki + treningi) zamiast deklaracji z profilu.
 * Dni bez wpisu liczą się jako dni bez treningu – inaczej średnia byłaby zawyżona.
 */
export function averageActivity(days: readonly DayActivity[], weightKg: number, endIso: string, window = 14, minDays = 5): MeasuredActivity | null {
  const start = addDays(endIso, -(window - 1));
  const inWindow = days.filter((d) => d.date >= start && d.date <= endIso);
  if (inWindow.length < minDays) return null;
  const span = Math.max(inWindow.length, Math.min(window, daysBetween(inWindow[0].date, endIso) + 1));
  const stepsSum = inWindow.reduce((s, d) => s + stepsKcal(d.steps, weightKg), 0);
  const workoutSum = inWindow.reduce((s, d) => s + d.workoutKcal, 0);
  const stepsAvg = inWindow.reduce((s, d) => s + d.steps, 0) / inWindow.length;
  return {
    stepsKcal: Math.round(stepsSum / span),
    trainingKcal: Math.round(workoutSum / span),
    days: inWindow.length,
    avgSteps: Math.round(stepsAvg),
  };
}

/** Podmienia szacowany ruch na zmierzony (z zegarka lub wpisów). */
export function withMeasuredActivity(estimate: EnergyEstimate, activity: MeasuredActivity | null): EnergyEstimate {
  if (!activity) return estimate;
  const total = estimate.baseKcal + activity.stepsKcal + activity.trainingKcal;
  return {
    ...estimate,
    stepsKcal: activity.stepsKcal,
    trainingKcal: activity.trainingKcal,
    tdee: total,
    pal: Math.round((total / estimate.bmr) * 100) / 100,
    source: 'measured',
  };
}

export function tdee(p: BodyParams): number {
  return estimateTdee(p).tdee;
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

/**
 * Cel dzienny. `measured` (TDEE policzone z dziennika i wagi) ma pierwszeństwo przed wzorem.
 * Deficyt ograniczamy do 25% zapotrzebowania, a całość do bezpiecznego minimum.
 */
export function computeTarget(body: BodyParams, settings: TargetSettings, measuredTdee?: number): ComputedTarget {
  const estimate = estimateTdee(body);
  const t = measuredTdee ?? estimate.tdee;
  const wanted = dailyAdjustment(settings.goal, settings.weeklyRatePct, body.weightKg);
  const maxDeficit = Math.round((t * MAX_DEFICIT_PCT) / 100);
  const adjustment = wanted < 0 ? Math.max(wanted, -maxDeficit) : wanted;
  const min = minimumKcal(body.sex, estimate.bmr);
  const raw = t + adjustment;
  const kcal = roundTo(Math.max(raw, min), 10);
  return {
    ...macrosFor(kcal, body.weightKg, settings),
    bmr: estimate.bmr,
    tdee: t,
    estimate,
    adjustment,
    clampedToMinimum: raw < min,
    clampedDeficit: adjustment !== wanted,
  };
}

/** Ogranicza tygodniową zmianę celu: najwyżej 100 kcal i najwyżej 10% poprzedniego celu. */
export function limitWeeklyChange(previousKcal: number | null, nextKcal: number): number {
  if (previousKcal === null) return nextKcal;
  const limit = Math.min(MAX_WEEKLY_CHANGE_KCAL, Math.round((previousKcal * MAX_WEEKLY_CHANGE_PCT) / 100));
  const diff = nextKcal - previousKcal;
  if (Math.abs(diff) <= limit) return nextKcal;
  return previousKcal + Math.sign(diff) * limit;
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

export interface MeasuredTdee {
  /** zapotrzebowanie policzone z bilansu energii */
  tdee: number;
  /** dni z wpisami w dzienniku w oknie */
  loggedDays: number;
  /** liczba ważeń w oknie */
  weighIns: number;
  /** trend masy ciała w kg na tydzień (ujemny = spadek) */
  slopeKgPerWeek: number;
  /** 0–0,8: na ile ufamy pomiarowi (rośnie z liczbą dni z danymi) */
  confidence: number;
}

/** Wygładzona masa ciała: regresja liniowa po wszystkich ważeniach w oknie. */
export function weightSlope(weights: readonly WeightPoint[], endIso: string, days: number): { slopeKgPerDay: number; points: number; spanDays: number } | null {
  const start = addDays(endIso, -(days - 1));
  const pts = weights
    .filter((w) => w.date >= start && w.date <= endIso)
    .map((w) => ({ x: daysBetween(start, w.date), y: Number(w.weight_kg) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const varX = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (varX === 0) return null;
  const cov = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  return { slopeKgPerDay: cov / varX, points: n, spanDays: pts[n - 1].x - pts[0].x };
}

/**
 * Rzeczywiste zapotrzebowanie z bilansu energii:
 * TDEE = średnie spożycie − (zmiana masy × 7700 kcal/kg) / dzień.
 * Trend masy liczymy regresją, żeby wahania wody nie psuły wyniku.
 * Wymagamy min. 10 dni z dziennikiem, 4 ważeń i 14 dni rozstępu między pierwszym a ostatnim ważeniem.
 */
export function measureTdee(
  intake: readonly IntakeDay[],
  weights: readonly WeightPoint[],
  endIso: string,
  days = 28,
): MeasuredTdee | null {
  const start = addDays(endIso, -(days - 1));
  const logged = intake.filter((d) => d.date >= start && d.date <= endIso && d.kcal > 0);
  const slope = weightSlope(weights, endIso, days);
  if (logged.length < 10 || !slope || slope.points < 4 || slope.spanDays < 14) return null;
  const avgIntake = logged.reduce((s, d) => s + d.kcal, 0) / logged.length;
  const tdeeValue = Math.round(avgIntake - slope.slopeKgPerDay * KCAL_PER_KG_FAT);
  const coverage = Math.min(1, logged.length / days) * Math.min(1, slope.points / (days / 2));
  return {
    tdee: tdeeValue,
    loggedDays: logged.length,
    weighIns: slope.points,
    slopeKgPerWeek: Math.round(slope.slopeKgPerDay * 7 * 100) / 100,
    confidence: Math.round(Math.min(0.8, coverage * 0.8) * 100) / 100,
  };
}

/**
 * Łączy zapotrzebowanie ze wzoru z tym zmierzonym z danych. Pomiar wchodzi tym mocniej,
 * im więcej dni jest zalogowanych, i nigdy nie odchyla wyniku o więcej niż 25% od wzoru
 * (zabezpieczenie przed niedoszacowanym dziennikiem i chorymi tygodniami).
 */
export function blendTdee(formulaTdee: number, measured: MeasuredTdee | null): { tdee: number; confidence: number; used: 'formula' | 'blend' } {
  if (!measured) return { tdee: formulaTdee, confidence: 0, used: 'formula' };
  const clamped = Math.min(Math.max(measured.tdee, formulaTdee * 0.75), formulaTdee * 1.25);
  const w = measured.confidence;
  return { tdee: Math.round(w * clamped + (1 - w) * formulaTdee), confidence: w, used: 'blend' };
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
