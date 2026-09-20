/**
 * Klient Open Food Facts (darmowa baza produktów spożywczych).
 * Na Androidzie zapytania idą natywnie (CapacitorHttp) – bez ograniczeń CORS i z własnym User-Agent.
 * Limity OFF: wyszukiwanie ok. 10 zapytań/min, produkt po kodzie ok. 100/min – dlatego szukamy po Enter.
 */
import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_pl,generic_name_pl,brands,nutriments,serving_quantity,quantity';
const USER_AGENT = 'MenuVibe/1.0 (prywatna aplikacja; karol.moleda90@gmail.com)';

export interface OffProduct {
  ean: string;
  name: string;
  brand: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  /** sugerowana porcja w g (z etykiety), jeśli jest */
  serving_g: number | null;
  /** opakowanie, np. „150 g” */
  quantity: string | null;
}

interface RawOffProduct {
  code?: string;
  product_name?: string;
  product_name_pl?: string;
  generic_name_pl?: string;
  brands?: string;
  quantity?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
}

/** Zamienia surowy rekord OFF na produkt; null, gdy brakuje nazwy lub kalorii. */
export function parseOffProduct(raw: RawOffProduct | null | undefined): OffProduct | null {
  if (!raw) return null;
  const n = raw.nutriments ?? {};
  const num = (v: unknown): number | null => {
    const x = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null) {
    // część produktów ma tylko kJ
    const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
    if (kj !== null) kcal = kj / 4.184;
  }
  const name = (raw.product_name_pl || raw.product_name || raw.generic_name_pl || '').trim();
  if (!name || kcal === null || kcal > 950) return null;
  const serving = num(raw.serving_quantity);
  return {
    ean: String(raw.code ?? '').trim(),
    name,
    brand: raw.brands?.split(',')[0]?.trim() || null,
    kcal_100g: round1(kcal),
    protein_100g: round1(num(n['proteins_100g']) ?? 0),
    carbs_100g: round1(num(n['carbohydrates_100g']) ?? 0),
    fat_100g: round1(num(n['fat_100g']) ?? 0),
    serving_g: serving && serving > 0 && serving < 2000 ? serving : null,
    quantity: raw.quantity?.trim() || null,
  };
}

/** Wartości dla podanej gramatury. */
export function nutritionFor(p: Pick<OffProduct, 'kcal_100g' | 'protein_100g' | 'carbs_100g' | 'fat_100g'>, grams: number) {
  const f = grams / 100;
  return {
    kcal: Math.round(p.kcal_100g * f),
    protein_g: round1(p.protein_100g * f),
    carbs_g: round1(p.carbs_100g * f),
    fat_g: round1(p.fat_100g * f),
  };
}

/** Poprawność kodu EAN-8/EAN-13/UPC-A (cyfra kontrolna). */
export function isValidEan(code: string): boolean {
  if (!/^\d{8}$|^\d{12,13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

@Injectable({ providedIn: 'root' })
export class OpenFoodFactsClient {
  /** Produkt po kodzie kreskowym; null, gdy nie ma go w bazie. */
  async byBarcode(ean: string): Promise<OffProduct | null> {
    const data = await this.get<{ status?: number; product?: RawOffProduct }>(
      `${BASE}/api/v2/product/${encodeURIComponent(ean)}?fields=${FIELDS}`,
    );
    if (!data || data.status === 0) return null;
    const p = parseOffProduct({ code: ean, ...data.product });
    return p ? { ...p, ean } : null;
  }

  /** Wyszukiwanie; najpierw produkty sprzedawane w Polsce, posortowane wg popularności. */
  async search(query: string, pageSize = 24): Promise<OffProduct[]> {
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: '1',
      action: 'process',
      json: '1',
      page_size: String(pageSize),
      sort_by: 'unique_scans_n',
      fields: FIELDS,
      tagtype_0: 'countries',
      tag_contains_0: 'contains',
      tag_0: 'poland',
      lc: 'pl',
    });
    const data = await this.get<{ products?: RawOffProduct[] }>(`${BASE}/cgi/search.pl?${params}`);
    const seen = new Set<string>();
    return (data?.products ?? [])
      .map(parseOffProduct)
      .filter((p): p is OffProduct => !!p && !!p.ean && !seen.has(p.ean) && !!seen.add(p.ean));
  }

  private async get<T>(url: string): Promise<T | null> {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, headers: { 'User-Agent': USER_AGENT }, readTimeout: 15000, connectTimeout: 10000 });
      if (res.status === 404) return (typeof res.data === 'object' ? res.data : null) as T | null;
      if (res.status === 429) throw new Error('Open Food Facts: za dużo zapytań, spróbuj za minutę.');
      if (res.status >= 400) throw new Error(`Open Food Facts: błąd ${res.status}`);
      return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
    }
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return (await res.json().catch(() => null)) as T | null;
    if (res.status === 429) throw new Error('Open Food Facts: za dużo zapytań, spróbuj za minutę.');
    if (!res.ok) throw new Error(`Open Food Facts: błąd ${res.status}`);
    return (await res.json()) as T;
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
