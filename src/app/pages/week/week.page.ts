import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ActionSheetController,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
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
import { chevronBackOutline, chevronForwardOutline, lockClosed, shuffleOutline } from 'ionicons/icons';
import { BodyStore } from '../../core/body.store';
import { MealPlanItemRow } from '../../core/database.types';
import { addDays } from '../../core/nutrition';
import { PlanStore } from '../../core/plan.store';
import { SLOTS, SLOT_LABELS, alternatives, factorFor, mondayOf, weekDates } from '../../core/planner';
import { RecipeStore } from '../../core/recipe.store';

const DAY_NAMES = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];

@Component({
  selector: 'app-week',
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonSpinner,
    IonText,
    IonModal,
    IonSearchbar,
  ],
  templateUrl: './week.page.html',
  styleUrl: './week.page.scss',
})
export class WeekPage {
  protected readonly plan = inject(PlanStore);
  protected readonly recipes = inject(RecipeStore);
  protected readonly body = inject(BodyStore);
  private readonly router = inject(Router);
  private readonly sheet = inject(ActionSheetController);
  private readonly toast = inject(ToastController);

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly busy = signal(false);

  /** komórka, dla której wybieramy zamiennik */
  protected readonly swapping = signal<MealPlanItemRow | null>(null);
  protected readonly swapQuery = signal('');

  protected readonly days = computed(() => {
    const byId = this.recipes.byId();
    const today = this.body.today();
    return weekDates(this.plan.weekStart()).map((date, i) => {
      const items = this.plan.itemsByDate().get(date) ?? [];
      const meals = SLOTS.map((slot) => {
        const item = items.find((x) => x.slot === slot) ?? null;
        const recipe = item ? byId.get(item.recipe_id) ?? null : null;
        const factor = item ? Number(item.portion_factor) : 1;
        return { slot, item, recipe, factor, kcal: recipe ? Math.round(recipe.kcal * factor) : 0 };
      });
      return {
        date,
        label: `${DAY_NAMES[i]} ${date.slice(8, 10)}.${date.slice(5, 7)}`,
        isToday: date === today,
        meals,
        total: meals.reduce((s, m) => s + m.kcal, 0),
      };
    });
  });

  protected readonly rangeLabel = computed(() => {
    const start = this.plan.weekStart();
    const end = addDays(start, 6);
    const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
    return `${fmt(start)} – ${fmt(end)}`;
  });

  protected readonly hasPlan = computed(() => this.plan.items().length > 0);

  protected readonly swapOptions = computed(() => {
    const item = this.swapping();
    const targets = this.plan.slotTargets();
    if (!item || !targets) return [];
    const target = targets[item.slot];
    const inWeek = new Set(this.plan.items().map((i) => i.recipe_id));
    const q = this.swapQuery().trim().toLowerCase();
    const byId = this.recipes.byId();
    return alternatives(this.recipes.forPlanner(), item.slot, target, inWeek)
      .map((r) => byId.get(r.id)!)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .slice(0, 60)
      .map((r) => {
        const factor = factorFor(r.kcal, target);
        return { recipe: r, factor, kcal: Math.round(r.kcal * factor) };
      });
  });

  constructor() {
    addIcons({ chevronBackOutline, chevronForwardOutline, lockClosed, shuffleOutline });
    void this.init();
  }

  private async init(): Promise<void> {
    await Promise.all([this.recipes.load(), this.plan.loadWeek(mondayOf(this.body.today()))]);
  }

  async changeWeek(delta: number): Promise<void> {
    await this.plan.loadWeek(addDays(this.plan.weekStart(), 7 * delta));
  }

  async generate(): Promise<void> {
    this.busy.set(true);
    try {
      await this.plan.generate();
      await this.showToast('Jadłospis gotowy. Dotknij posiłku, żeby go zamienić lub zablokować.');
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  async openMeal(meal: { item: MealPlanItemRow | null; recipe: { id: string; name: string } | null; factor: number }): Promise<void> {
    const item = meal.item;
    if (!item || !meal.recipe) return;
    const sheet = await this.sheet.create({
      header: meal.recipe.name,
      buttons: [
        { text: 'Pokaż przepis', handler: () => void this.showRecipe(item) },
        { text: 'Zamień na inny', handler: () => this.startSwap(item) },
        { text: item.locked ? 'Odblokuj' : 'Zablokuj (zostaje przy losowaniu)', handler: () => void this.toggleLock(item) },
        { text: 'Anuluj', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  startSwap(item: MealPlanItemRow): void {
    this.swapQuery.set('');
    this.swapping.set(item);
  }

  async chooseSwap(recipeId: string): Promise<void> {
    const item = this.swapping();
    this.swapping.set(null);
    if (!item) return;
    try {
      await this.plan.swap(item, recipeId);
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    }
  }

  private async showRecipe(item: MealPlanItemRow): Promise<void> {
    await this.router.navigate(['/przepisy', item.recipe_id], {
      queryParams: { slot: item.slot, servings: Number(item.portion_factor) },
    });
  }

  private async toggleLock(item: MealPlanItemRow): Promise<void> {
    try {
      await this.plan.toggleLock(item);
    } catch (e) {
      await this.showToast(errorMessage(e), 'danger');
    }
  }

  private async showToast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, color, position: 'top' });
    await t.present();
  }

  protected formatFactor(f: number): string {
    return `×${String(f).replace('.', ',')}`;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Nieznany błąd';
}
