import { Component, input } from '@angular/core';
import { IonContent, IonHeader, IonText, IonTitle, IonToolbar } from '@ionic/angular';

/** Tymczasowy ekran dla zakładek, które powstaną w kolejnych etapach. */
@Component({
  selector: 'app-placeholder-page',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonText],
  // header i content muszą być bezpośrednio w .ion-page, więc host nie tworzy własnego pudełka
  host: { style: 'display: contents' },
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title() }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-text color="medium">
        <p>{{ description() }}</p>
        <p>Ten ekran powstanie w etapie {{ stage() }}.</p>
      </ion-text>
    </ion-content>
  `,
})
export class PlaceholderPage {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly stage = input.required<number>();
}
