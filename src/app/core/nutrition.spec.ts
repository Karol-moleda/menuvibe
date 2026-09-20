import {
  addDays,
  ageOn,
  blendTdee,
  bmr,
  classifyTrend,
  computeTarget,
  dailyAdjustment,
  estimateTdee,
  limitWeeklyChange,
  macrosFor,
  measureTdee,
  nextRecalcDate,
  stepsKcal,
  tdee,
  trainingKcal,
  todayIso,
  weightTrend,
  WeightPoint,
} from './nutrition';

const activity = { jobPal: 1.15, dailySteps: 8000, trainingDays: 4, trainingMinutes: 60, trainingMet: 6 };
const karol = { sex: 'male' as const, age: 35, heightCm: 182, weightKg: 90, activity };
const cut = { goal: 'cut' as const, weeklyRatePct: 0.5, proteinGPerKg: 1.8, fatPct: 25 };

describe('zapotrzebowanie', () => {
  it('BMR Mifflin-St Jeor dla mężczyzny i kobiety', () => {
    expect(bmr(karol)).toBe(1868);
    expect(bmr({ sex: 'female', age: 30, heightCm: 165, weightKg: 55 })).toBe(1270);
  });

  it('BMR Katch-McArdle, gdy znany jest procent tłuszczu', () => {
    // masa beztłuszczowa 90 × 0,8 = 72 kg → 370 + 21,6 × 72
    expect(bmr({ ...karol, bodyFatPct: 20 })).toBe(1925);
  });

  it('chodzenie liczone dopiero powyżej 2500 kroków', () => {
    expect(stepsKcal(2500, 90)).toBe(0);
    expect(stepsKcal(10000, 90)).toBe(304);
  });

  it('trening liczony netto (MET − 1) i rozłożony na tydzień', () => {
    // 4 × 60 min przy 6 MET, 90 kg → (6-1)×3,5×90/200×60 = 472,5 kcal na trening
    expect(trainingKcal(activity, 90)).toBe(270);
    expect(trainingKcal({ ...activity, trainingDays: 0 }, 90)).toBe(0);
  });

  it('TDEE to suma składników, a nie jeden mnożnik', () => {
    const e = estimateTdee(karol);
    expect(e.bmr).toBe(1868);
    expect(e.baseKcal).toBe(2148);
    expect(e.stepsKcal).toBe(223);
    expect(e.trainingKcal).toBe(270);
    expect(e.tdee).toBe(2641);
    expect(e.pal).toBeCloseTo(1.41, 2);
    expect(tdee(karol)).toBe(2641);
  });

  it('deficyt z tempa 0,5%/tydz. przy 90 kg = 495 kcal', () => {
    expect(dailyAdjustment('cut', 0.5, 90)).toBe(-495);
    expect(dailyAdjustment('gain', 0.25, 80)).toBe(220);
    expect(dailyAdjustment('maintain', 1, 90)).toBe(0);
  });

  it('cel i makro', () => {
    const t = computeTarget(karol, cut);
    expect(t.kcal).toBe(2150);
    expect(t.protein_g).toBe(162);
    expect(t.clampedToMinimum).toBe(false);
    expect(t.clampedDeficit).toBe(false);
  });

  it('deficyt nie przekracza 25% zapotrzebowania', () => {
    const t = computeTarget(karol, { ...cut, weeklyRatePct: 1.5 });
    expect(t.adjustment).toBe(-660);
    expect(t.clampedDeficit).toBe(true);
  });

  it('nie schodzi poniżej BMR', () => {
    const maly = { ...karol, activity: { ...activity, trainingDays: 0, dailySteps: 2000 } };
    const t = computeTarget(maly, { ...cut, weeklyRatePct: 1.5 });
    expect(t.kcal).toBe(1870);
    expect(t.clampedToMinimum).toBe(true);
  });

  it('używa zmierzonego zapotrzebowania, jeśli jest', () => {
    expect(computeTarget(karol, cut, 3000).kcal).toBe(2510);
  });

  it('makro sumuje się do kcal (±10)', () => {
    const m = macrosFor(2200, 80, cut);
    expect(Math.abs(m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9 - 2200)).toBeLessThanOrEqual(10);
  });

  it('ogranicza tygodniową zmianę do 100 kcal', () => {
    expect(limitWeeklyChange(2400, 2000)).toBe(2300);
    expect(limitWeeklyChange(2400, 2450)).toBe(2450);
    expect(limitWeeklyChange(null, 1900)).toBe(1900);
  });
});

describe('daty', () => {
  it('wiek liczony do dnia urodzin', () => {
    expect(ageOn('1990-09-21', '2026-09-20')).toBe(35);
    expect(ageOn('1990-09-21', '2026-09-21')).toBe(36);
  });

  it('kolejne przeliczenie w ustalony dzień tygodnia, nie wcześniej niż za 7 dni', () => {
    // 2026-09-21 to poniedziałek
    expect(nextRecalcDate('2026-09-21', 1)).toBe('2026-09-28');
    expect(nextRecalcDate('2026-09-23', 1)).toBe('2026-10-05');
    expect(nextRecalcDate('2026-09-21', 5)).toBe('2026-10-02');
  });

  it('dodawanie dni i dzisiejsza data w Polsce', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(todayIso(new Date('2026-09-19T22:30:00Z'))).toBe('2026-09-20');
  });
});

function series(start: string, days: number, from: number, perDay: number): WeightPoint[] {
  return Array.from({ length: days }, (_, i) => ({ date: addDays(start, i), weight_kg: from + perDay * i }));
}

describe('trend wagi', () => {
  it('zbiera dane przy za małej liczbie ważeń', () => {
    const t = weightTrend(series('2026-09-10', 5, 90, -0.1), '2026-09-14', 'cut', 0.5);
    expect(t.status).toBe('collecting');
    expect(t.average).not.toBeNull();
  });

  it('spadek 0,1 kg/dzień przy 90 kg to redukcja w tempie', () => {
    const t = weightTrend(series('2026-09-01', 14, 90, -0.1), '2026-09-14', 'cut', 0.5);
    expect(t.weeklyChangeKg).toBeCloseTo(-0.7, 2);
    expect(t.weeklyChangePct).toBeCloseTo(-0.78, 2);
    expect(t.status).toBe('on_track');
  });

  it('klasyfikacja tempa', () => {
    expect(classifyTrend(-0.1, 'cut', 0.5)).toBe('too_slow');
    expect(classifyTrend(-1.4, 'cut', 0.5)).toBe('too_fast');
    expect(classifyTrend(0.3, 'cut', 0.5)).toBe('wrong_direction');
    expect(classifyTrend(0.1, 'maintain', 0)).toBe('on_track');
  });
});

describe('zapotrzebowanie zmierzone z danych', () => {
  const intake = Array.from({ length: 28 }, (_, i) => ({ date: addDays('2026-09-01', i), kcal: 2400 }));

  it('liczy zapotrzebowanie z bilansu energii i trendu wagi', () => {
    const w = series('2026-09-01', 28, 90, -0.05);
    const m = measureTdee(intake, w, '2026-09-28')!;
    // spadek 0,05 kg/dzień = 385 kcal deficytu dziennie
    expect(m.tdee).toBe(2785);
    expect(m.slopeKgPerWeek).toBeCloseTo(-0.35, 2);
    expect(m.loggedDays).toBe(28);
    expect(m.confidence).toBeGreaterThan(0.5);
  });

  it('zwraca null przy dziurawym dzienniku albo zbyt krótkim okresie ważeń', () => {
    const w = series('2026-09-01', 28, 90, -0.05);
    expect(measureTdee(intake.slice(0, 5), w, '2026-09-28')).toBeNull();
    expect(measureTdee(intake, series('2026-09-20', 8, 90, -0.05), '2026-09-28')).toBeNull();
  });

  it('łączy wzór z pomiarem i nie pozwala odjechać dalej niż 25% od wzoru', () => {
    const m = measureTdee(intake, series('2026-09-01', 28, 90, -0.05), '2026-09-28')!;
    const blended = blendTdee(2641, m);
    expect(blended.used).toBe('blend');
    expect(blended.tdee).toBeGreaterThan(2641);
    expect(blended.tdee).toBeLessThan(2785);
    // pomiar mocno odstający zostaje przycięty
    expect(blendTdee(2600, { ...m, tdee: 5000, confidence: 0.8 }).tdee).toBe(3120);
    expect(blendTdee(2600, null)).toEqual({ tdee: 2600, confidence: 0, used: 'formula' });
  });
});
