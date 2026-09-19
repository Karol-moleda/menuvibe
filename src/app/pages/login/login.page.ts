import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonInput,
  IonInputPasswordToggle,
  IonList,
  IonItem,
  IonSpinner,
  IonText,
} from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    IonContent,
    IonList,
    IonItem,
    IonInput,
    IonInputPasswordToggle,
    IonButton,
    IonSpinner,
    IonText,
  ],
  styleUrl: './login.page.scss',
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** 'login' albo 'signup' – rejestracja działa tylko dla pierwszego konta */
  readonly mode = signal<'login' | 'signup'>('login');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });

  toggleMode(): void {
    this.mode.update((m) => (m === 'login' ? 'signup' : 'login'));
    this.error.set(null);
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    const error =
      this.mode() === 'signup'
        ? await this.auth.signUp(email.trim(), password)
        : await this.auth.signIn(email.trim(), password);
    this.loading.set(false);
    if (error) {
      this.error.set(error);
      return;
    }
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
