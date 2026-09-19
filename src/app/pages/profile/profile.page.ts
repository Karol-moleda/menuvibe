import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-profile',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonText],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Profil</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list>
        <ion-item>
          <ion-label>
            <p>Zalogowany jako</p>
            <h2>{{ auth.user()?.email }}</h2>
          </ion-label>
        </ion-item>
      </ion-list>
      <ion-text color="medium">
        <p>Parametry ciała, cel i comiesięczne przeliczanie kalorii pojawią się w etapie 2.</p>
      </ion-text>
      <ion-button expand="block" fill="outline" color="danger" (click)="logout()">Wyloguj</ion-button>
    </ion-content>
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async logout(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
