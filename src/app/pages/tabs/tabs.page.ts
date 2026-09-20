import { Component, inject } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs, ToastController } from '@ionic/angular';
import { BodyStore } from '../../core/body.store';
import { signed } from '../../shared/labels';
import { addIcons } from 'ionicons';
import { calendarOutline, chatbubblesOutline, personOutline, restaurantOutline, todayOutline } from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dzis">
          <ion-icon name="today-outline" aria-hidden="true" />
          <ion-label>Dziś</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="tydzien">
          <ion-icon name="calendar-outline" aria-hidden="true" />
          <ion-label>Tydzień</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="przepisy">
          <ion-icon name="restaurant-outline" aria-hidden="true" />
          <ion-label>Przepisy</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="czat">
          <ion-icon name="chatbubbles-outline" aria-hidden="true" />
          <ion-label>Czat</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="profil">
          <ion-icon name="person-outline" aria-hidden="true" />
          <ion-label>Profil</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage {
  private readonly body = inject(BodyStore);
  private readonly toast = inject(ToastController);

  constructor() {
    addIcons({ todayOutline, calendarOutline, restaurantOutline, chatbubblesOutline, personOutline });
    void this.init();
  }

  /** Po zalogowaniu: wczytaj profil i – jeśli nadszedł dzień – przelicz miesięczny cel kcal. */
  private async init(): Promise<void> {
    try {
      await this.body.load();
      const result = await this.body.ensureMonthlyTarget();
      if (result) {
        const diff = result.previousKcal !== null ? ` (${signed(result.target.kcal - result.previousKcal, 0)} kcal)` : '';
        const t = await this.toast.create({
          message: `Nowy miesięczny cel: ${result.target.kcal} kcal${diff}`,
          duration: 4000,
          color: 'success',
          position: 'top',
        });
        await t.present();
      }
    } catch (e) {
      console.error('Nie udało się wczytać profilu', e);
    }
  }
}
