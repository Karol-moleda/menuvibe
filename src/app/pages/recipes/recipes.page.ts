import { Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/placeholder-page';

@Component({
  selector: 'app-recipes',
  imports: [PlaceholderPage],
  template: `<app-placeholder-page title="Przepisy" description="Baza przepisów od dietetyczek i od Claude." [stage]="3" />`,
})
export class RecipesPage {}
