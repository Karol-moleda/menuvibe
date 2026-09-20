import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  RefresherCustomEvent,
  ToastController,
} from '@ionic/angular';
import { AuthService } from '../../core/auth.service';
import { BodyStore } from '../../core/body.store';
import { ACTIVITY_LEVELS, ageOn } from '../../core/nutrition';
import { GOAL_LABELS, METHOD_LABELS, TREND_LABELS, formatDatePl, signed } from '../../shared/labels';

@Component({
  selector: 'app-profile',
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
    IonCardSubtitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonLabel,
    IonNote,
    IonInput,
    IonButton,
    IonBadge,
    IonText,
    IonSpinner,
  ],
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(BodyStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);
  private readonly alert = inject(AlertController);

  protected readonly goalLabels = GOAL_LABELS;
  protected readonly methodLabels = METHOD_LABELS;
  protected readonly trendLabels = TREND_LABELS;
  protected readonly formatDate = formatDatePl;
  protected readonly signed = signed;

  protected readonly weightInput = signal<string>('');
  protected readonly busy = signal(false);

  protected readonly recentWeights = computed(() => this.store.weights().slice(0, 10));
  protected readonly recentTargets = computed(() => this.store.targets().slice(0, 6));

  protected readonly summary = computed(() => {
    const p = this.store.profile();
    if (!p) return null;
    const activity = ACTIVITY_LEVELS.find((a) => a.pal === Number(p.activity_pal));
    return {
      sex: p.sex === 'male' ? 'Mężczyzna' : p.sex === 'female' ? 'Kobieta' : '—',
      age: p.birth_date ? `${ageOn(p.birth_date, this.store.today())} lat` : '—',
      height: p.height_cm ? `${Number(p.height_cm)} cm` : '—',
      activity: activity?.label ?? '—',
      goal: `${GOAL_LABELS[p.goal]}${p.goal === 'maintain' ? '' : `, ${String(Number(p.weekly_rate_pct)).replace('.', ',')}% masy/tydz.`}`,
    };
  });

  constructor() {
    if (!this.store.loaded()) void this.reload();
  }

  async reload(event?: RefresherCustomEvent): Promise<void> {
    try {
      await this.store.load();
    } catch (e) {
      await this.showError(e);
    } finally {
      await event?.target.complete();
    }
  }

  async saveWeight(): Promise<void> {
    const value = Number(this.weightInput().replace(',', '.'));
    if (!Number.isFinite(value) || value < 30 || value > 300) {
      await this.showToast('Podaj wagę w kg, np. 88,4', 'warning');
      return;
    }
    await this.run(async () => {
      const firstTarget = !this.store.currentTarget();
      await this.store.addWeight(Math.round(value * 10) / 10);
      this.weightInput.set('');
      const result = firstTarget ? await this.store.ensureMonthlyTarget() : null;
      await this.showToast(result ? `Zapisano. Twój cel: ${result.target.kcal} kcal dziennie.` : 'Zapisano wagę.');
    });
  }

  async deleteWeight(id: string): Promise<void> {
    await this.run(() => this.store.deleteWeight(id));
  }

  async recalculate(): Promise<void> {
    await this.run(async () => {
      const { target, previousKcal } = await this.store.recalculate();
      const diff = previousKcal !== null ? ` (${signed(target.kcal - previousKcal, 0)} kcal)` : '';
      await this.showToast(`Nowy cel: ${target.kcal} kcal${diff}`);
    });
  }

  async setManualTarget(): Promise<void> {
    const current = this.store.currentTarget();
    const alert = await this.alert.create({
      header: 'Cel od dietetyczki',
      message: 'Wpisz kcal. Makro możesz zostawić puste – policzę je z Twoich ustawień.',
      inputs: [
        { name: 'kcal', type: 'number', placeholder: 'kcal', value: current?.kcal, min: 1000, max: 6000 },
        { name: 'protein', type: 'number', placeholder: 'białko g (opcjonalnie)' },
        { name: 'carbs', type: 'number', placeholder: 'węglowodany g (opcjonalnie)' },
        { name: 'fat', type: 'number', placeholder: 'tłuszcz g (opcjonalnie)' },
      ],
      buttons: [
        { text: 'Anuluj', role: 'cancel' },
        {
          text: 'Zapisz',
          handler: (v: { kcal: string; protein: string; carbs: string; fat: string }) => {
            const kcal = Number(v.kcal);
            if (!Number.isFinite(kcal) || kcal < 1000 || kcal > 6000) return false;
            const num = (x: string) => (x ? Number(x) : undefined);
            void this.run(async () => {
              await this.store.setManualTarget(kcal, { protein_g: num(v.protein), carbs_g: num(v.carbs), fat_g: num(v.fat) });
              await this.showToast(`Ustawiono cel ${kcal} kcal. Automatyczne przeliczanie jest wstrzymane.`);
            });
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
    this.store.reset();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      await this.showError(e);
    } finally {
      this.busy.set(false);
    }
  }

  private async showError(e: unknown): Promise<void> {
    const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : 'Nieznany błąd';
    await this.showToast(`Błąd: ${message}`, 'danger');
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success'): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, color, position: 'top' });
    await t.present();
  }
}
