import { Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/placeholder-page';

@Component({
  selector: 'app-week',
  imports: [PlaceholderPage],
  template: `<app-placeholder-page title="Tydzień" description="Wygenerowany jadłospis na 7 dni z możliwością podmiany posiłków." [stage]="3" />`,
})
export class WeekPage {}
