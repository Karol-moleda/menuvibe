import { Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { BodyStore } from '../../core/body.store';
import { TREND_LABELS, signed } from '../../shared/labels';

@Component({
  selector: 'app-today',
  imports: [
    DecimalPipe,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonCardContent,
    IonBadge,
    IonButton,
    IonText,
    IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Dziś</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (!body.loaded()) {
        <div class="center"><ion-spinner name="crescent" aria-label="Ładowanie" /></div>
      } @else if (!body.currentTarget()) {
        <ion-card color="light">
          <ion-card-header>
            <ion-card-title>Zacznijmy od Twoich danych</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p>Podaj wzrost, wiek, aktywność i wagę – policzę dzienne zapotrzebowanie i cel na redukcję.</p>
            <ion-button routerLink="/profil" expand="block">Przejdź do profilu</ion-button>
          </ion-card-content>
        </ion-card>
      } @else {
        @let t = body.currentTarget()!;
        @let trend = body.trend();
        <ion-card>
          <ion-card-header>
            <ion-card-subtitle>Cel na dziś</ion-card-subtitle>
            <ion-card-title class="kcal">{{ t.kcal }} <small>kcal</small></ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <div class="macros">
              <span class="macro protein"><strong>{{ t.protein_g }} g</strong> B</span>
              <span class="macro carbs"><strong>{{ t.carbs_g }} g</strong> W</span>
              <span class="macro fat"><strong>{{ t.fat_g }} g</strong> T</span>
            </div>
          </ion-card-content>
        </ion-card>

        <ion-card routerLink="/profil" button>
          <ion-card-header>
            <ion-card-subtitle>Redukcja</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <div class="trend">
              <ion-badge [color]="labels[trend.status].color">{{ labels[trend.status].label }}</ion-badge>
              @if (trend.average !== null) {
                <span>{{ trend.average | number: '1.1-1' }} kg średnio</span>
              }
              @if (trend.weeklyChangeKg !== null) {
                <span>· {{ signed(trend.weeklyChangeKg, 2) }} kg/tydz.</span>
              }
            </div>
            @if (body.latestWeight()?.date !== body.today()) {
              <ion-text color="medium"><p>Nie ważyłeś się dziś – dotknij, żeby dodać pomiar.</p></ion-text>
            }
          </ion-card-content>
        </ion-card>

        <ion-text color="medium">
          <p class="ion-padding-horizontal">Dziennik posiłków, bilans kcal i woda pojawią się w etapie 3.</p>
        </ion-text>
      }
    </ion-content>
  `,
  styles: `
    .center { display: flex; justify-content: center; padding: 48px; }
    .kcal { font-size: 2.25rem; font-weight: 700; }
    .kcal small { font-size: 1rem; font-weight: 400; color: var(--ion-color-medium); }
    .macros { display: flex; gap: 16px; }
    .macro { padding-left: 10px; border-left: 4px solid; }
    .macro.protein { border-color: var(--mv-protein); }
    .macro.carbs { border-color: var(--mv-carbs); }
    .macro.fat { border-color: var(--mv-fat); }
    .trend { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  `,
})
export class TodayPage {
  protected readonly body = inject(BodyStore);
  protected readonly labels = TREND_LABELS;
  protected readonly signed = signed;
}
