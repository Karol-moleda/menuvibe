import {
  addDays,
  adaptiveTdee,
  ageOn,
  bmr,
  classifyTrend,
  computeTarget,
  dailyAdjustment,
  limitMonthlyChange,
  macrosFor,
  nextRecalcDate,
  tdee,
  todayIso,
  weightTrend,
  WeightPoint,
} from './nutrition';

const karol = { sex: 'male' as const, age: 35, heightCm: 182, weightKg: 90, pal: 1.55 };
const cut = { goal: 'cut' as const, weeklyRatePct: 0.5, proteinGPerKg: 1.8, fatPct: 25 };

describe('zapotrzebowanie', () => {
  it('BMR Mifflin-St Jeor dla mężczyzny i kobiety', () => {
    expect(bmr(karol)).toBe(1868);
    expect(bmr({ sex: 'female', age: 30, heightCm: 165, weightKg: 55 })).toBe(1270);
  });

  it('TDEE = BMR × PAL', () => {
    expect(tdee(karol)).toBe(2895);
  });

  it('deficyt z tempa 0,5%/tydz. przy 90 kg = 495 kcal', () => {
    expect(dailyAdjustment('cut', 0.5, 90)).toBe(-495);
    expect(dailyAdjustment('gain', 0.25, 80)).toBe(220);
    expect(dailyAdjustment('maintain', 1, 90)).toBe(0);
  });

  it('cel i makro', () => {
    const t = computeTarget(karol, cut);
    expect(t.kcal).toBe(2400);
    expect(t.protein_g).toBe(162);
    expect(t.fat_g).toBe(67);
    expect(t.carbs_g).toBe(287);
    expect(t.clampedToMinimum).toBe(false);
  });

  it('nie schodzi poniżej BMR', () => {
    const t = computeTarget({ ...karol, pal: 1.2 }, { ...cut, weeklyRatePct: 1.5 });
    expect(t.kcal).toBe(1870);
    expect(t.clampedToMinimum).toBe(true);
  });

  it('używa zmierzonego TDEE, jeśli jest', () => {
    expect(computeTarget(karol, cut, 3000).kcal).toBe(2510);
  });

  it('makro sumuje się do kcal (±10)', () => {
    const m = macrosFor(2200, 80, cut);
    expect(Math.abs(m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9 - 2200)).toBeLessThanOrEqual(10);
  });

  it('ogranicza miesięczną zmianę do 250 kcal', () => {
    expect(limitMonthlyChange(2400, 2000)).toBe(2150);
    expect(limitMonthlyChange(2400, 2550)).toBe(2550);
    expect(limitMonthlyChange(null, 1900)).toBe(1900);
  });
});

describe('daty', () => {
  it('wiek liczony do dnia urodzin', () => {
    expect(ageOn('1990-09-21', '2026-09-20')).toBe(35);
    expect(ageOn('1990-09-21', '2026-09-21')).toBe(36);
  });

  it('kolejne przeliczenie w następnym miesiącu', () => {
    expect(nextRecalcDate('2026-09-01', 1)).toBe('2026-10-01');
    expect(nextRecalcDate('2026-12-15', 5)).toBe('2027-01-05');
    // mniej niż 14 dni do przeliczenia – przesuwamy o miesiąc
    expect(nextRecalcDate('2026-09-20', 1)).toBe('2026-11-01');
    expect(nextRecalcDate('2026-11-25', 1)).toBe('2027-01-01');
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

describe('adaptacyjne TDEE', () => {
  const intake = Array.from({ length: 28 }, (_, i) => ({ date: addDays('2026-09-01', i), kcal: 2400 }));

  it('liczy TDEE z bilansu i zmiany wagi', () => {
    const w = series('2026-09-01', 28, 90, -0.1);
    expect(adaptiveTdee(intake, w, '2026-09-28')).toBe(3170);
  });

  it('zwraca null przy dziurawym dzienniku', () => {
    const w = series('2026-09-01', 28, 90, -0.1);
    expect(adaptiveTdee(intake.slice(0, 15), w, '2026-09-28')).toBeNull();
  });
});
