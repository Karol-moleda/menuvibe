import { Component, computed, inject, input, numberAttribute, resource, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonModal,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, heart, heartOutline, removeOutline, swapHorizontalOutline, thumbsDown, thumbsDownOutline } from 'ionicons/icons';
import { DiaryStore } from '../../core/diary.store';
import { PlanStore } from '../../core/plan.store';
import { Food, FoodStore, Swap } from '../../core/foods';
import { RecipePhotoComponent } from '../../shared/recipe-photo';
import { MealSlot } from '../../core/database.types';
import { SLOTS, SLOT_LABELS } from '../../core/planner';
import { RecipeStore } from '../../core/recipe.store';
import { todayIso } from '../../core/nutrition';

@Component({
  selector: 'app-recipe-detail',
  imports: [
    DecimalPipe,
    IonHeader,
    IonToolbar,
    RecipePhotoComponent,
    IonModal,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonText,
  ],
  templateUrl: './recipe-detail.page.html',
  styleUrl: './recipe-detail.page.scss',
})
export class RecipeDetailPage {
  private readonly recipes = inject(RecipeStore);
  private readonly diary = inject(DiaryStore);
  private readonly plan = inject(PlanStore);
  protected readonly foodStore = inject(FoodStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);

  /** z adresu /przepisy/:id?slot=&servings=&add=1 */
  readonly id = input.required<string>();
  readonly slot = input<MealSlot | undefined>(undefined);
  readonly servings = input(1, { transform: numberAttribute });
  readonly add = input(0, { transform: numberAttribute });

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;

  protected readonly portion = signal<number | null>(null);
  /** składnik, dla którego pokazujemy zamienniki */
  protected readonly swapFor = signal<{ name: string; grams: number; kcal: number; food: Food } | null>(null);
  protected readonly targetSlot = signal<MealSlot | null>(null);
  protected readonly saving = signal(false);

  protected readonly data = resource({
    params: () => this.id(),
    loader: async ({ params }) => {
      await this.recipes.load();
      const [recipe, ingredients] = await Promise.all([this.recipes.details(params), this.recipes.ingredients(params)]);
      return { recipe, ingredients };
    },
  });

  protected readonly summary = computed(() => this.recipes.byId().get(this.id()) ?? null);
  protected readonly chosenSlot = computed(() => this.targetSlot() ?? this.slot() ?? this.data.value()?.recipe.slot ?? 'lunch');

  /** Ile kcal zostało jeszcze w tym posiłku (cel slotu minus to, co już zjedzone). */
  protected readonly slotBudget = computed(() => {
    const target = this.plan.slotTargets()?.[this.chosenSlot()];
    if (!target) return null;
    const eaten = (this.diary.bySlot().get(this.chosenSlot()) ?? []).reduce((s, e) => s + e.kcal, 0);
    return { target, eaten, left: Math.max(0, target - eaten) };
  });

  /**
   * Porcja dopasowana do posiłku: tyle przepisu, żeby wyszło mniej więcej tyle kcal,
   * ile zostało w tym posiłku. Trzymamy się zakresu 0,5–2 porcji, żeby nie wychodziły absurdy.
   */
  protected readonly suggested = computed(() => {
    const budget = this.slotBudget();
    const kcal = this.summary()?.kcal ?? this.data.value()?.recipe.kcal;
    if (!budget || !kcal || budget.left < 50) return null;
    const raw = budget.left / kcal;
    return Math.min(2, Math.max(0.5, Math.round(raw * 20) / 20));
  });

  protected readonly factor = computed(() => {
    if (this.portion() !== null) return this.portion()!;
    // porcja z planu (?servings=) ma pierwszeństwo, potem dopasowanie do posiłku
    const fromPlan = Number.isFinite(this.servings()) ? this.servings() : 1;
    if (fromPlan !== 1) return fromPlan;
    return this.slot() ? this.suggested() ?? 1 : 1;
  });

  protected readonly scaled = computed(() => {
    const d = this.data.value();
    if (!d) return null;
    const f = this.factor();
    const r = d.recipe;
    // składniki są na cały przepis; na talerz trafia `f` porcji
    const perPlate = f / r.servings;
    return {
      kcal: Math.round(r.kcal * f),
      protein: Math.round(r.protein_g * f),
      carbs: Math.round(r.carbs_g * f),
      fat: Math.round(r.fat_g * f),
      ingredients: d.ingredients.map((i) => {
        const amount = Math.round(Number(i.amount) * perPlate * (Number(i.amount) < 10 ? 10 : 1)) / (Number(i.amount) < 10 ? 10 : 1);
        return { ...i, scaledAmount: amount, hasSwaps: i.unit === 'g' && this.foodStore.match(i.name) !== null };
      }),
    };
  });

  protected readonly swapOptions = computed<Swap[]>(() => {
    const sw = this.swapFor();
    return sw ? this.foodStore.swaps(sw.food, sw.grams) : [];
  });

  protected signedG(v: number): string {
    return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1).replace('.', ',')} g`;
  }

  /** Otwiera listę zamienników dla składnika (gramatura już przeliczona na Twoją porcję). */
  showSwaps(i: { name: string; scaledAmount: number; unit: string }): void {
    const food = this.foodStore.match(i.name);
    if (!food || i.unit !== 'g') return;
    const grams = Math.round(i.scaledAmount);
    this.swapFor.set({ name: i.name, grams, kcal: Math.round((food.kcal * grams) / 100), food });
  }

  constructor() {
    // budżet posiłku liczymy z dzisiejszego dziennika
    if (this.diary.date() !== todayIso() || !this.diary.loaded()) void this.diary.load(todayIso()).catch(() => undefined);
    void this.foodStore.load().catch(() => undefined);
    addIcons({ heart, heartOutline, thumbsDown, thumbsDownOutline, addOutline, removeOutline, swapHorizontalOutline });
  }

  usePortion(value: number): void {
    this.portion.set(value);
  }

  resetPortion(): void {
    this.portion.set(1);
  }

  changePortion(delta: number): void {
    const next = Math.round((this.factor() + delta) * 10) / 10;
    this.portion.set(Math.min(3, Math.max(0.3, next)));
  }

  async rate(value: 1 | -1): Promise<void> {
    const current = this.summary()?.rating ?? 0;
    const rating = current === value ? 0 : value;
    await this.recipes.setRating(this.id(), rating);
    this.data.value.update((d) => (d ? { ...d, recipe: { ...d.recipe, rating } } : d));
  }

  async addToDiary(): Promise<void> {
    const recipe = this.summary();
    if (!recipe) return;
    this.saving.set(true);
    try {
      if (this.diary.date() !== todayIso()) await this.diary.load(todayIso());
      await this.diary.addRecipe(recipe, this.chosenSlot(), this.factor());
      const t = await this.toast.create({
        message: `Dodano do dziennika: ${recipe.name} (${this.scaled()?.kcal} kcal)`,
        duration: 2500,
        color: 'success',
        position: 'top',
      });
      await t.present();
      if (this.add()) await this.router.navigateByUrl('/dzis');
    } finally {
      this.saving.set(false);
    }
  }
}
