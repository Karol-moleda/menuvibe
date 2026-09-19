import { Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/placeholder-page';

@Component({
  selector: 'app-today',
  imports: [PlaceholderPage],
  template: `<app-placeholder-page title="Dziś" description="Bilans kcal i makro na dziś, posiłki z planu, woda." [stage]="3" />`,
})
export class TodayPage {}
