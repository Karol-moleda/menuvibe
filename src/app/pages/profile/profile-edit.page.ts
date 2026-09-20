import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonInput,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { BodyStore } from '../../core/body.store';
import { Goal, Sex } from '../../core/database.types';
import { ACTIVITY_LEVELS, ComputedTarget, ageOn, computeTarget, todayIso } from '../../core/nutrition';

@Component({
  selector: 'app-profile-edit',
  imports: [
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonFooter,
    IonLabel,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonButton,
  ],
  templateUrl: './profile-edit.page.html',
  styleUrl: './profile-edit.page.scss',
})
export class ProfileEditPage {
  private readonly store = inject(BodyStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);

  protected readonly activityLevels = ACTIVITY_LEVELS;
  protected readonly rates = [
    { rate: 0.25, title: 'Łagodnie' },
    { rate: 0.5, title: 'Umiarkowanie' },
    { rate: 0.75, title: 'Szybko' },
    { rate: 1, title: 'Bardzo szybko' },
  ];
  protected readonly maxBirthDate = todayIso();
  protected readonly saving = signal(false);
  protected readonly formatPct = (r: number) => `${String(r).replace('.', ',')}%`;

  protected readonly form = new FormGroup({
    sex: new FormControl<Sex | null>(null, Validators.required),
    birth_date: new FormControl<string | null>(null, Validators.required),
    height_cm: new FormControl<number | null>(null, [Validators.required, Validators.min(100), Validators.max(250)]),
    activity_pal: new FormControl<number | null>(null, Validators.required),
    goal: new FormControl<Goal>('cut', { nonNullable: true }),
    weekly_rate_pct: new FormControl<number>(0.5, { nonNullable: true }),
    protein_g_per_kg: new FormControl<number>(1.8, { nonNullable: true, validators: [Validators.min(0.8), Validators.max(3)] }),
    fat_pct: new FormControl<number>(25, { nonNullable: true, validators: [Validators.min(15), Validators.max(45)] }),
    water_goal_ml: new FormControl<number>(3000, { nonNullable: true, validators: [Validators.min(500), Validators.max(6000)] }),
    recalc_day: new FormControl<number>(1, { nonNullable: true, validators: [Validators.min(1), Validators.max(28)] }),
  });

  protected readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly weight = computed(() => {
    const w = this.store.referenceWeight();
    return w === null ? null : Math.round(w * 10) / 10;
  });

  /** Cel kcal dla bieżących wartości formularza (opcjonalnie z inną aktywnością lub tempem). */
  private targetFor(patch: { pal?: number; rate?: number; goal?: Goal } = {}): ComputedTarget | null {
    const v = { ...this.form.getRawValue(), ...this.values() };
    const w = this.weight();
    const pal = patch.pal ?? v.activity_pal;
    if (!v.sex || !v.birth_date || !v.height_cm || !pal || w === null) return null;
    return computeTarget(
      { sex: v.sex, age: ageOn(v.birth_date, todayIso()), heightCm: Number(v.height_cm), weightKg: w, pal: Number(pal) },
      {
        goal: patch.goal ?? v.goal ?? 'cut',
        weeklyRatePct: Number(patch.rate ?? v.weekly_rate_pct),
        proteinGPerKg: Number(v.protein_g_per_kg),
        fatPct: Number(v.fat_pct),
      },
    );
  }

  protected readonly preview = computed(() => this.targetFor());

  protected readonly activityOptions = computed(() => {
    const selected = Number(this.values().activity_pal);
    return this.activityLevels.map((a) => ({
      ...a,
      selected: a.pal === selected,
      tdee: this.targetFor({ pal: a.pal, goal: 'maintain' })?.tdee ?? null,
    }));
  });

  protected readonly rateOptions = computed(() => {
    const v = this.values();
    const w = this.weight();
    return this.rates.map((r) => ({
      ...r,
      selected: r.rate === Number(v.weekly_rate_pct),
      kg: w ? `${v.goal === 'gain' ? '+' : '−'}${((w * r.rate) / 100).toFixed(2).replace('.', ',')} kg` : '',
      kcal: this.targetFor({ rate: r.rate })?.kcal ?? null,
    }));
  });

  protected pick(control: 'activity_pal' | 'weekly_rate_pct', value: number): void {
    this.form.controls[control].setValue(value);
    this.form.controls[control].markAsDirty();
  }

  constructor() {
    if (!this.store.loaded()) void this.store.load();
    // wypełnij formularz, gdy profil się wczyta
    effect(() => {
      const p = this.store.profile();
      if (!p || this.form.dirty) return;
      this.form.reset({
        sex: p.sex,
        birth_date: p.birth_date,
        height_cm: p.height_cm !== null ? Number(p.height_cm) : null,
        activity_pal: p.activity_pal !== null ? Number(p.activity_pal) : null,
        goal: p.goal,
        weekly_rate_pct: Number(p.weekly_rate_pct) || 0.5,
        protein_g_per_kg: Number(p.protein_g_per_kg),
        fat_pct: Number(p.fat_pct),
        water_goal_ml: p.water_goal_ml,
        recalc_day: p.recalc_day,
      });
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.showToast('Uzupełnij wymagane pola.', 'warning');
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      await this.store.saveProfile({
        ...v,
        height_cm: Number(v.height_cm),
        activity_pal: Number(v.activity_pal),
        weekly_rate_pct: v.goal === 'maintain' ? 0 : Number(v.weekly_rate_pct),
      });
      // nowe ustawienia od razu zmieniają cel (poza celem wpisanym ręcznie)
      const current = this.store.currentTarget();
      const result =
        (await this.store.ensureMonthlyTarget()) ??
        (current && current.method !== 'manual' && this.store.formulaPreview()?.kcal !== current.kcal
          ? await this.store.recalculate({ automatic: false })
          : null);
      if (result) {
        await this.showToast(`Zapisano. Twój cel: ${result.target.kcal} kcal dziennie.`);
      } else if (!this.store.latestWeight()) {
        await this.showToast('Zapisano. Dodaj wagę, żeby policzyć cel.');
      } else {
        await this.showToast('Zapisano. Użyj „Przelicz teraz”, jeśli chcesz od razu zmienić cel.');
      }
      this.form.markAsPristine();
      await this.router.navigateByUrl('/profil');
    } catch (e) {
      const message = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      await this.showToast(`Błąd: ${message}`, 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success'): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, color, position: 'top' });
    await t.present();
  }
}
