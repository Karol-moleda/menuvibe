import { Component } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
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
  constructor() {
    addIcons({ todayOutline, calendarOutline, restaurantOutline, chatbubblesOutline, personOutline });
  }
}
