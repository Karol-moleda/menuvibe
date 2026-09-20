import { Goal, TargetMethod } from '../core/database.types';
import { TrendStatus } from '../core/nutrition';

export const GOAL_LABELS: Record<Goal, string> = {
  cut: 'Redukcja',
  maintain: 'Utrzymanie',
  gain: 'Budowa masy',
};

export const METHOD_LABELS: Record<TargetMethod, string> = {
  formula: 'ze wzoru',
  adaptive: 'z Twoich danych',
  manual: 'ustawiony ręcznie',
};

export const TREND_LABELS: Record<TrendStatus, { label: string; color: string; hint: string }> = {
  collecting: { label: 'Zbieram dane', color: 'medium', hint: 'Waż się codziennie rano – ocena pojawi się po ok. 10 dniach.' },
  on_track: { label: 'W tempie', color: 'success', hint: 'Tempo zgodne z celem. Tak trzymaj.' },
  too_slow: { label: 'Za wolno', color: 'warning', hint: 'Waga spada wolniej niż zakładasz. Sprawdź, czy liczysz wszystko, co jesz.' },
  too_fast: { label: 'Za szybko', color: 'warning', hint: 'Tracisz więcej niż 1% masy tygodniowo. Rozważ zwiększenie kalorii.' },
  wrong_direction: { label: 'Brak postępu', color: 'danger', hint: 'Średnia waga nie zmienia się w stronę celu.' },
};

export function formatDatePl(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

export function signed(v: number, digits = 1): string {
  const s = v.toFixed(digits).replace('.', ',');
  return v > 0 ? `+${s}` : s;
}
