import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonFab,
  IonFabButton,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { heart, moonOutline, nutritionOutline, restaurantOutline, sparkles, sunnyOutline } from 'ionicons/icons';
import { MealSlot } from '../../core/database.types';
import { SLOT_ICONS } from '../../shared/labels';
import { RecipePhotoComponent } from '../../shared/recipe-photo';
import { RecipeSummary, RecipeStore } from '../../core/recipe.store';
import { SLOTS, SLOT_LABELS } from '../../core/planner';

@Component({
  selector: 'app-recipes',
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonList,
    IonItem,
    IonNote,
    IonIcon,
    IonSpinner,
    RecipePhotoComponent,
    IonFab,
    IonFabButton,
    IonText,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Przepisy</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar placeholder="Szukaj po nazwie lub składniku" [value]="query()" (ionInput)="query.set($event.detail.value ?? '')" />
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [value]="slot()" (ionChange)="slot.set($any($event.detail.value))" scrollable>
          <ion-segment-button value="all"><ion-label>Wszystkie</ion-label></ion-segment-button>
          @for (s of slots; track s) {
            <ion-segment-button [value]="s"><ion-label>{{ slotLabels[s] }}</ion-label></ion-segment-button>
          }
          <ion-segment-button value="claude"><ion-label>Od Claude</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (store.importing()) {
        <div class="center">
          <ion-spinner name="crescent" />
          <p>Importuję przepisy od dietetyczek…</p>
        </div>
      } @else if (!store.loaded()) {
        <div class="center"><ion-spinner name="crescent" aria-label="Ładowanie" /></div>
      } @else {
        <ion-list>
          @for (row of filtered(); track row.recipe.id) {
            @let r = row.recipe;
            <ion-item [routerLink]="['/przepisy', r.id]" [queryParams]="linkParams()" detail [class.disliked]="r.rating < 0">
              <app-recipe-photo class="thumb" [slug]="r.slug" slot="start">
                <span class="slot-icon" [class]="r.slot">
                  <ion-icon [name]="slotIcons[r.slot]" aria-hidden="true" />
                </span>
              </app-recipe-photo>
              <ion-label>
                <h3>
                  @if (r.rating > 0) {
                    <ion-icon name="heart" color="danger" aria-label="Lubię" />
                  }
                  {{ r.name }}
                  @if (r.origin === 'claude') {
                    <ion-icon name="sparkles" color="primary" aria-label="Od Claude" />
                  }
                </h3>
                <p>{{ slotLabels[r.slot] }} · B {{ round(r.protein_g) }} · W {{ round(r.carbs_g) }} · T {{ round(r.fat_g) }}</p>
                @if (row.hit) {
                  <p class="hit">zawiera: {{ row.hit }}</p>
                }
              </ion-label>
              <ion-note slot="end">{{ r.kcal }} kcal</ion-note>
            </ion-item>
          } @empty {
            <ion-text color="medium">
              <p class="ion-padding">
                {{ slot() === 'claude' ? 'Tu trafią przepisy wymyślone w czacie z Claude.' : 'Brak przepisów dla tego wyszukiwania.' }}
              </p>
            </ion-text>
          }
        </ion-list>
      }
      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button routerLink="/czat" aria-label="Czat z Claude">
          <ion-icon name="sparkles" />
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    ion-list { background: transparent; margin: 8px 16px; border-radius: var(--mv-radius); overflow: hidden; box-shadow: var(--mv-shadow); }
    ion-list ion-label h3 { font-weight: 600; }
    .thumb { width: 60px; height: 60px; margin: 8px 12px 8px 0; flex-shrink: 0; }
    .thumb .slot-icon { width: 100%; height: 100%; border-radius: 12px; }
    .center { display: flex; flex-direction: column; align-items: center; padding: 48px; color: var(--ion-color-medium); }
    h3 ion-icon { vertical-align: -2px; margin-right: 4px; }
    .disliked { opacity: 0.5; }
    .hit { color: var(--ion-color-primary); font-size: 0.78rem; }
  `,
})
export class RecipesPage {
  protected readonly store = inject(RecipeStore);
  private readonly route = inject(ActivatedRoute);

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly slotIcons = SLOT_ICONS;
  protected readonly round = Math.round;

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** slot z adresu (?slot=), gdy lista otwarta z „Dodaj” na ekranie Dziś */
  private readonly addToSlot = computed(() => this.params().get('slot') as MealSlot | null);

  protected readonly query = signal('');
  protected readonly slot = linkedSignal<MealSlot | 'all' | 'claude'>(() => this.addToSlot() ?? 'all');

  /** Parametry przekazywane do szczegółów przepisu. */
  protected readonly linkParams = computed(() => {
    const addTo = this.addToSlot();
    return addTo ? { slot: addTo, add: 1 } : {};
  });

  protected readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    const slot = this.slot();
    const ing = this.store.ingredientIndex();
    const matches = (r: RecipeSummary) => {
      if (!q) return true;
      if (normalize(r.name).includes(q)) return true;
      const list = ing.get(r.id);
      return !!list && normalize(list).includes(q);
    };
    return this.store
      .recipes()
      .filter((r) => (slot === 'all' || r.slot === slot || (slot === 'claude' && r.origin === 'claude')) && matches(r))
      .map((r) => ({ recipe: r, hit: q && !normalize(r.name).includes(q) ? ingredientHit(ing.get(r.id) ?? '', q) : null }))
      .sort((a, b) => b.recipe.rating - a.recipe.rating || a.recipe.name.localeCompare(b.recipe.name, 'pl'));
  });

  constructor() {
    addIcons({ heart, sparkles, sunnyOutline, nutritionOutline, restaurantOutline, moonOutline });
    void this.store.load();
  }
}

/** Nazwa składnika, która pasuje do zapytania – pokazujemy ją pod przepisem. */
function ingredientHit(list: string, q: string): string | null {
  const found = list
    .split(' ')
    .filter(Boolean)
    .find((w) => normalize(w).includes(q));
  return found ?? null;
}

/** Wyszukiwanie bez polskich znaków: „zupa krem” = „zupą krem”. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
}
