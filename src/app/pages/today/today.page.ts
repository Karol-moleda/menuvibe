import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  RefresherCustomEvent,
  ToastController,
  ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, addCircleOutline, arrowUndoOutline, checkmark, checkmarkCircle, moonOutline, nutritionOutline, restaurantOutline, sunnyOutline, water, waterOutline } from 'ionicons/icons';
import { BodyStore } from '../../core/body.store';
import { DiaryStore } from '../../core/diary.store';
import { MealPlanItemRow, MealSlot } from '../../core/database.types';
import { todayIso } from '../../core/nutrition';
import { PlanStore } from '../../core/plan.store';
import { SLOTS, SLOT_LABELS } from '../../core/planner';
import { RecipeStore } from '../../core/recipe.store';
import { SLOT_ICONS, TREND_LABELS, signed } from '../../shared/labels';

@Component({
  selector: 'app-today',
  imports: [
    DecimalPipe,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonLabel,
    IonNote,
    IonBadge,
    IonButton,
    IonIcon,
    IonText,
    IonSpinner,
  ],
  templateUrl: './today.page.html',
  styleUrl: './today.page.scss',
})
export class TodayPage implements ViewWillEnter {
  protected readonly body = inject(BodyStore);
  protected readonly diary = inject(DiaryStore);
  protected readonly plan = inject(PlanStore);
  private readonly recipes = inject(RecipeStore);
  private readonly router = inject(Router);
  private readonly sheet = inject(ActionSheetController);
  private readonly alert = inject(AlertController);
  private readonly toast = inject(ToastController);

  protected readonly labels = TREND_LABELS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly slotIcons = SLOT_ICONS;
  protected readonly signed = signed;
  protected readonly round = Math.round;
  protected readonly ringLength = 2 * Math.PI * 52;
  protected readonly todayLabel = capitalize(new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()));

  protected readonly planned = signal<MealPlanItemRow[]>([]);
  protected readonly busy = signal(false);

  protected readonly target = computed(() => this.body.currentTarget());

  protected readonly progress = computed(() => {
    const t = this.target();
    const eaten = this.diary.totals();
    if (!t) return null;
    const bar = (v: number, max: number) => ({ value: Math.round(v), max, ratio: max ? Math.min(1, v / max) : 0, over: v > max * 1.05 });
    return {
      kcal: bar(eaten.kcal, t.kcal),
      remaining: t.kcal - eaten.kcal,
      protein: bar(eaten.protein_g, t.protein_g),
      carbs: bar(eaten.carbs_g, t.carbs_g),
      fat: bar(eaten.fat_g, t.fat_g),
    };
  });

  protected readonly meals = computed(() => {
    const byId = this.recipes.byId();
    const entries = this.diary.bySlot();
    const targets = this.plan.slotTargets();
    return SLOTS.map((slot) => {
      const item = this.planned().find((p) => p.slot === slot) ?? null;
      const recipe = item ? byId.get(item.recipe_id) ?? null : null;
      const logged = entries.get(slot) ?? [];
      const plannedEaten = !!item && logged.some((e) => e.recipe_id === item.recipe_id);
      return {
        slot,
        entries: logged,
        targetKcal: targets?.[slot] ?? null,
        kcal: logged.reduce((s, e) => s + e.kcal, 0),
        planned: item && recipe && !plannedEaten ? { item, recipe, kcal: Math.round(recipe.kcal * Number(item.portion_factor)) } : null,
      };
    });
  });

  protected readonly waterGoal = computed(() => this.body.profile()?.water_goal_ml ?? 3000);

  /** Szklanki po 250 ml: pełne na początku, puste do końca celu. */
  protected readonly glasses = computed(() => {
    const total = Math.ceil(this.waterGoal() / 250);
    const full = Math.round(this.diary.waterMl() / 250);
    return Array.from({ length: Math.max(total, full) }, (_, i) => i < full);
  });

  constructor() {
    addIcons({ add, addCircleOutline, arrowUndoOutline, checkmark, checkmarkCircle, moonOutline, nutritionOutline, restaurantOutline, sunnyOutline, water, waterOutline });
  }

  ionViewWillEnter(): void {
    void this.refresh();
  }

  async refresh(event?: RefresherCustomEvent): Promise<void> {
    try {
      const today = todayIso();
      await Promise.all([this.diary.load(today), this.recipes.load(), this.loadPlanned(today)]);
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    } finally {
      await event?.target.complete();
    }
  }

  private async loadPlanned(date: string): Promise<void> {
    this.planned.set(await this.plan.itemsForDate(date));
  }

  async eatPlanned(meal: { item: MealPlanItemRow }): Promise<void> {
    const recipe = this.recipes.byId().get(meal.item.recipe_id);
    if (!recipe) return;
    await this.run(() => this.diary.addRecipe(recipe, meal.item.slot, Number(meal.item.portion_factor)));
  }

  openPlanned(item: MealPlanItemRow): void {
    void this.router.navigate(['/przepisy', item.recipe_id], {
      queryParams: { slot: item.slot, servings: Number(item.portion_factor), add: 1 },
    });
  }

  async addTo(slot: MealSlot): Promise<void> {
    const sheet = await this.sheet.create({
      header: `Dodaj – ${SLOT_LABELS[slot]}`,
      buttons: [
        { text: 'Produkt – wyszukaj lub zeskanuj', handler: () => void this.router.navigate(['/produkt'], { queryParams: { slot } }) },
        { text: 'Z przepisów', handler: () => void this.router.navigate(['/przepisy'], { queryParams: { slot } }) },
        { text: 'Szybki wpis (tylko nazwa i kcal)', handler: () => void this.quickAdd(slot) },
        { text: 'Anuluj', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async quickAdd(slot: MealSlot): Promise<void> {
    const alert = await this.alert.create({
      header: `Szybki wpis – ${SLOT_LABELS[slot]}`,
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Co zjadłeś? np. batonik' },
        { name: 'kcal', type: 'number', placeholder: 'kcal', min: 0 },
        { name: 'protein', type: 'number', placeholder: 'białko g (opcjonalnie)' },
        { name: 'carbs', type: 'number', placeholder: 'węglowodany g (opcjonalnie)' },
        { name: 'fat', type: 'number', placeholder: 'tłuszcz g (opcjonalnie)' },
      ],
      buttons: [
        { text: 'Anuluj', role: 'cancel' },
        {
          text: 'Dodaj',
          handler: (v: { name: string; kcal: string; protein: string; carbs: string; fat: string }) => {
            const kcal = Number(v.kcal);
            if (!v.name?.trim() || !Number.isFinite(kcal) || kcal < 0) return false;
            void this.run(() =>
              this.diary.add({
                slot,
                kind: 'manual',
                name: v.name.trim(),
                kcal: Math.round(kcal),
                protein_g: Number(v.protein) || 0,
                carbs_g: Number(v.carbs) || 0,
                fat_g: Number(v.fat) || 0,
              }),
            );
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async remove(id: string): Promise<void> {
    await this.run(() => this.diary.remove(id));
  }

  async addWater(ml: number): Promise<void> {
    await this.run(() => this.diary.addWater(ml));
  }

  async undoWater(): Promise<void> {
    await this.run(() => this.diary.undoWater());
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  private async showToast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, color, position: 'top' });
    await t.present();
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Nieznany błąd';
}
