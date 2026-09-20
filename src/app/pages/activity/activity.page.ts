import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonCard,
  IonCardContent,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
  ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, barbellOutline, flameOutline, footstepsOutline, walkOutline, watchOutline } from 'ionicons/icons';
import { ActivityStore, SPORTS, workoutKcal } from '../../core/activity.store';
import { BodyStore } from '../../core/body.store';
import { addDays, todayIso } from '../../core/nutrition';

@Component({
  selector: 'app-activity',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonItem,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonLabel,
    IonNote,
    IonChip,
    IonIcon,
    IonSpinner,
  ],
  templateUrl: './activity.page.html',
  styleUrl: './activity.page.scss',
})
export class ActivityPage implements ViewWillEnter {
  protected readonly store = inject(ActivityStore);
  private readonly body = inject(BodyStore);
  private readonly alert = inject(AlertController);
  private readonly toast = inject(ToastController);

  protected readonly sports = SPORTS;
  protected readonly busy = signal(false);
  protected readonly stepGoal = 10000;

  protected readonly weight = computed(() => this.body.referenceWeight() ?? 80);

  /** Kcal z kroków dziś (ponad to, co siedzi już w trybie dnia). */
  protected readonly stepsKcalToday = computed(() => {
    const steps = Math.max(0, this.store.today().steps - 2500);
    return Math.round((steps / 1000) * 0.45 * this.weight());
  });

  protected readonly todayKcal = computed(() => this.stepsKcalToday() + this.store.today().workoutKcal);

  /** Ostatnie 7 dni do paska „tydzień”. */
  protected readonly week = computed(() => {
    const end = todayIso();
    const days = this.store.byDay();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(end, i - 6);
      const d = days.find((x) => x.date === date);
      const steps = d?.steps ?? 0;
      return {
        date,
        label: ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'][(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7],
        steps,
        ratio: Math.min(1, steps / this.stepGoal),
        workoutKcal: d?.workoutKcal ?? 0,
        isToday: date === end,
      };
    });
  });

  /** „Dziś”, „Wczoraj” albo „pon. 15.09”. */
  protected dayLabel(date: string): string {
    const today = todayIso();
    if (date === today) return 'Dziś';
    if (date === addDays(today, -1)) return 'Wczoraj';
    const d = new Date(`${date}T12:00:00Z`);
    const name = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: 'UTC' }).format(d);
    return `${name} ${date.slice(8, 10)}.${date.slice(5, 7)}`;
  }

  protected readonly avg = computed(() => this.body.activityMeasured());

  constructor() {
    addIcons({ footstepsOutline, barbellOutline, flameOutline, walkOutline, watchOutline, addOutline });
  }

  ionViewWillEnter(): void {
    void this.store.load().catch(() => undefined);
  }

  async editSteps(): Promise<void> {
    const a = await this.alert.create({
      header: 'Kroki dzisiaj',
      message: 'Przepisz liczbę kroków z zegarka albo telefonu.',
      inputs: [{ name: 'steps', type: 'number', min: 0, max: 100000, value: this.store.today().steps || null, placeholder: 'np. 8400' }],
      buttons: [
        { text: 'Anuluj', role: 'cancel' },
        {
          text: 'Zapisz',
          handler: (v: { steps: string }) => {
            const steps = Math.round(Number(v.steps));
            if (!Number.isFinite(steps) || steps < 0 || steps > 100000) return false;
            void this.run(() => this.store.setSteps(steps));
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  async addWorkout(sportKey: string): Promise<void> {
    const sport = this.sports.find((s) => s.key === sportKey)!;
    const a = await this.alert.create({
      header: sport.label,
      message: 'Podaj czas. Kalorie policzę sam, a jeśli masz je z zegarka – wpisz swoje.',
      inputs: [
        { name: 'minutes', type: 'number', min: 1, max: 600, placeholder: 'minuty', value: 60 },
        { name: 'kcal', type: 'number', min: 0, max: 5000, placeholder: 'kcal z zegarka (opcjonalnie)' },
      ],
      buttons: [
        { text: 'Anuluj', role: 'cancel' },
        {
          text: 'Dodaj',
          handler: (v: { minutes: string; kcal: string }) => {
            const minutes = Math.round(Number(v.minutes));
            if (!Number.isFinite(minutes) || minutes < 1) return false;
            const fromWatch = Math.round(Number(v.kcal));
            const kcal = Number.isFinite(fromWatch) && fromWatch > 0 ? fromWatch : workoutKcal(sport.met, minutes, this.weight());
            void this.run(() => this.store.addWorkout({ sport: sport.label, minutes, kcal }));
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  async remove(id: string): Promise<void> {
    await this.run(() => this.store.remove(id));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      const t = await this.toast.create({ message: `Błąd: ${message}`, duration: 3000, color: 'danger', position: 'top' });
      await t.present();
    } finally {
      this.busy.set(false);
    }
  }
}
