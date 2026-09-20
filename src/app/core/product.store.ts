import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { ProductRow } from './database.types';
import { OffProduct } from './off';

export type ProductInput = Pick<ProductRow, 'name' | 'kcal_100g' | 'protein_100g' | 'carbs_100g' | 'fat_100g'> &
  Partial<Pick<ProductRow, 'ean' | 'brand' | 'default_grams' | 'source'>>;

/** Własne produkty: zapisane z Open Food Facts, dodane ręcznie, ulubione i ostatnio używane. */
@Injectable({ providedIn: 'root' })
export class ProductStore {
  private readonly db = inject(SupabaseService).client;

  readonly products = signal<ProductRow[]>([]);
  readonly loaded = signal(false);

  readonly favorites = computed(() => this.products().filter((p) => p.favorite));
  readonly recent = computed(() =>
    this.products()
      .filter((p) => !p.favorite && p.last_used_at)
      .sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''))
      .slice(0, 20),
  );

  async load(): Promise<void> {
    const { data, error } = await this.db.from('products').select('*').order('name');
    if (error) throw error;
    this.products.set((data ?? []) as ProductRow[]);
    this.loaded.set(true);
  }

  findByEan(ean: string): ProductRow | null {
    return this.products().find((p) => p.ean === ean) ?? null;
  }

  /** Szukanie wśród własnych produktów (bez polskich znaków). */
  searchLocal(query: string): ProductRow[] {
    const q = normalize(query);
    if (!q) return [];
    return this.products().filter((p) => normalize(`${p.name} ${p.brand ?? ''}`).includes(q));
  }

  /** Zapisuje produkt z OFF (albo zwraca istniejący o tym kodzie). */
  async saveFromOff(p: OffProduct): Promise<ProductRow> {
    return this.upsert({
      ean: p.ean,
      name: p.name,
      brand: p.brand,
      kcal_100g: p.kcal_100g,
      protein_100g: p.protein_100g,
      carbs_100g: p.carbs_100g,
      fat_100g: p.fat_100g,
      default_grams: p.serving_g,
      source: 'off',
    });
  }

  async create(input: ProductInput): Promise<ProductRow> {
    return this.upsert({ source: 'manual', ...input });
  }

  async toggleFavorite(p: ProductRow): Promise<void> {
    await this.patch(p.id, { favorite: !p.favorite });
  }

  /** Zapamiętuje użycie i ostatnią gramaturę – następnym razem podpowiemy tę samą. */
  async markUsed(p: ProductRow, grams: number): Promise<void> {
    await this.patch(p.id, { last_used_at: new Date().toISOString(), default_grams: grams });
  }

  private async upsert(input: ProductInput): Promise<ProductRow> {
    const existing = input.ean ? this.findByEan(input.ean) : null;
    if (existing) return existing;
    const { data, error } = await this.db.from('products').insert(input).select('*').single();
    if (error) throw error;
    const row = data as ProductRow;
    this.products.update((l) => [...l, row]);
    return row;
  }

  private async patch(id: string, patch: Partial<ProductRow>): Promise<void> {
    const { error } = await this.db.from('products').update(patch).eq('id', id);
    if (error) throw error;
    this.products.update((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
