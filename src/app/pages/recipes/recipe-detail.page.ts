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
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, heart, heartOutline, removeOutline, thumbsDown, thumbsDownOutline } from 'ionicons/icons';
import { DiaryStore } from '../../core/diary.store';
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
  protected readonly factor = computed(() => this.portion() ?? (Number.isFinite(this.servings()) ? this.servings() : 1));
  protected readonly chosenSlot = computed(() => this.targetSlot() ?? this.slot() ?? this.data.value()?.recipe.slot ?? 'lunch');

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
      ingredients: d.ingredients.map((i) => ({
        ...i,
        scaledAmount: Math.round(Number(i.amount) * perPlate * (Number(i.amount) < 10 ? 10 : 1)) / (Number(i.amount) < 10 ? 10 : 1),
        showHousehold: Math.abs(perPlate - 1) < 0.01,
      })),
    };
  });

  constructor() {
    addIcons({ heart, heartOutline, thumbsDown, thumbsDownOutline, addOutline, removeOutline });
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
