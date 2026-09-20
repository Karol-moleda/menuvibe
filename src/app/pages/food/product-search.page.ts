import { Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonSearchbar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, barcodeOutline, star, starOutline } from 'ionicons/icons';
import { DiaryStore } from '../../core/diary.store';
import { MealSlot, ProductRow } from '../../core/database.types';
import { todayIso } from '../../core/nutrition';
import { OffProduct, OpenFoodFactsClient, isValidEan, nutritionFor } from '../../core/off';
import { SLOT_LABELS } from '../../core/planner';
import { ProductStore } from '../../core/product.store';
import { ScannerService } from '../../core/scanner';

/** Produkt wybrany do dodania – z własnej bazy albo prosto z Open Food Facts. */
interface Selected {
  saved: ProductRow | null;
  off: OffProduct | null;
  name: string;
  brand: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  serving_g: number | null;
}

@Component({
  selector: 'app-product-search',
  imports: [
    DecimalPipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonSearchbar,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonSpinner,
    IonText,
    IonModal,
    IonInput,
    IonChip,
  ],
  templateUrl: './product-search.page.html',
  styleUrl: './product-search.page.scss',
})
export class ProductSearchPage {
  private readonly off = inject(OpenFoodFactsClient);
  protected readonly products = inject(ProductStore);
  protected readonly scanner = inject(ScannerService);
  private readonly diary = inject(DiaryStore);
  private readonly router = inject(Router);
  private readonly alert = inject(AlertController);
  private readonly toast = inject(ToastController);

  /** ?slot= z ekranu Dziś */
  readonly slot = input<MealSlot>('snack');
  protected readonly slotLabels = SLOT_LABELS;

  protected readonly query = signal('');
  protected readonly searching = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly offResults = signal<OffProduct[] | null>(null);
  protected readonly lastSearch = signal('');

  protected readonly selected = signal<Selected | null>(null);
  protected readonly grams = signal(100);
  protected readonly saving = signal(false);

  protected readonly localResults = computed(() => this.products.searchLocal(this.query()).slice(0, 15));
  protected readonly showHome = computed(() => !this.query().trim());

  protected readonly preview = computed(() => {
    const s = this.selected();
    return s ? nutritionFor(s, this.grams() || 0) : null;
  });

  protected readonly gramChips = computed(() => {
    const s = this.selected();
    const chips = [50, 100, 150, 200];
    if (s?.serving_g && !chips.includes(s.serving_g)) chips.unshift(s.serving_g);
    return chips;
  });

  constructor() {
    addIcons({ barcodeOutline, star, starOutline, addOutline });
    if (!this.products.loaded()) void this.products.load();
  }

  onInput(value: string): void {
    this.query.set(value);
    if (!value.trim()) {
      this.offResults.set(null);
      this.searchError.set(null);
    }
  }

  /** Wyszukiwanie w Open Food Facts – po Enter (limit zapytań OFF). */
  async searchOff(): Promise<void> {
    const q = this.query().trim();
    if (q.length < 2 || this.searching()) return;
    if (isValidEan(q)) {
      await this.lookupEan(q);
      return;
    }
    this.searching.set(true);
    this.searchError.set(null);
    this.lastSearch.set(q);
    try {
      this.offResults.set(await this.off.search(q));
    } catch (e) {
      this.searchError.set(errorMessage(e));
      this.offResults.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  async scan(): Promise<void> {
    try {
      const code = await this.scanner.scan();
      if (code) await this.lookupEan(code);
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    }
  }

  private async lookupEan(ean: string): Promise<void> {
    const local = this.products.findByEan(ean);
    if (local) {
      this.selectSaved(local);
      return;
    }
    this.searching.set(true);
    try {
      const found = await this.off.byBarcode(ean);
      if (found) this.selectOff(found);
      else await this.createOwn(ean, `Nie ma produktu ${ean} w Open Food Facts. Dodaj go sam – wystarczą wartości z etykiety.`);
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    } finally {
      this.searching.set(false);
    }
  }

  selectSaved(p: ProductRow): void {
    this.selected.set({
      saved: p,
      off: null,
      name: p.name,
      brand: p.brand,
      kcal_100g: Number(p.kcal_100g),
      protein_100g: Number(p.protein_100g),
      carbs_100g: Number(p.carbs_100g),
      fat_100g: Number(p.fat_100g),
      serving_g: p.default_grams ? Number(p.default_grams) : null,
    });
    this.grams.set(p.default_grams ? Number(p.default_grams) : 100);
  }

  selectOff(p: OffProduct): void {
    const saved = this.products.findByEan(p.ean);
    if (saved) {
      this.selectSaved(saved);
      return;
    }
    this.selected.set({ saved: null, off: p, ...p });
    this.grams.set(p.serving_g ?? 100);
  }

  async toggleFavorite(): Promise<void> {
    const s = this.selected();
    if (!s) return;
    const row = s.saved ?? (s.off ? await this.products.saveFromOff(s.off) : null);
    if (!row) return;
    await this.products.toggleFavorite(row);
    this.selected.set({ ...s, saved: this.products.products().find((p) => p.id === row.id) ?? row });
  }

  async addSelected(): Promise<void> {
    const s = this.selected();
    const grams = this.grams();
    if (!s || !(grams > 0)) return;
    this.saving.set(true);
    try {
      const row = s.saved ?? (await this.products.saveFromOff(s.off!));
      if (this.diary.date() !== todayIso()) await this.diary.load(todayIso());
      const n = nutritionFor(s, grams);
      await this.diary.add({
        slot: this.slot(),
        kind: 'product',
        product_id: row.id,
        name: s.brand ? `${s.name} (${s.brand})` : s.name,
        grams,
        ...n,
      });
      await this.products.markUsed(row, grams);
      this.selected.set(null);
      await this.showToast(`Dodano: ${s.name}, ${grams} g (${n.kcal} kcal)`);
      await this.router.navigateByUrl('/dzis');
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  /** Własny produkt – gdy nie ma go w Open Food Facts. */
  async createOwn(ean: string | null = null, message?: string): Promise<void> {
    const alert = await this.alert.create({
      header: 'Własny produkt',
      message: message ?? 'Wartości odżywcze na 100 g – przepisz je z etykiety.',
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Nazwa, np. Baton Proteinowy X', value: this.query().trim() && !isValidEan(this.query().trim()) ? this.query().trim() : '' },
        { name: 'kcal', type: 'number', placeholder: 'kcal w 100 g' },
        { name: 'protein', type: 'number', placeholder: 'białko g w 100 g' },
        { name: 'carbs', type: 'number', placeholder: 'węglowodany g w 100 g' },
        { name: 'fat', type: 'number', placeholder: 'tłuszcz g w 100 g' },
        { name: 'serving', type: 'number', placeholder: 'typowa porcja g (opcjonalnie)' },
      ],
      buttons: [
        { text: 'Anuluj', role: 'cancel' },
        {
          text: 'Zapisz',
          handler: (v: Record<string, string>) => {
            const kcal = Number(v['kcal']);
            if (!v['name']?.trim() || !Number.isFinite(kcal) || kcal <= 0 || kcal > 950) return false;
            void this.products
              .create({
                ean,
                name: v['name'].trim(),
                kcal_100g: kcal,
                protein_100g: Number(v['protein']) || 0,
                carbs_100g: Number(v['carbs']) || 0,
                fat_100g: Number(v['fat']) || 0,
                default_grams: Number(v['serving']) || null,
              })
              .then((row) => this.selectSaved(row))
              .catch((e) => this.showToast(errorMessage(e), 'danger'));
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  setGrams(value: string | number | null | undefined): void {
    const n = Number(String(value ?? '').replace(',', '.'));
    this.grams.set(Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  }

  private async showToast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, color, position: 'top' });
    await t.present();
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Nie udało się połączyć. Sprawdź internet.';
}
