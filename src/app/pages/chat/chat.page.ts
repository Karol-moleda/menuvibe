import { Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/placeholder-page';

@Component({
  selector: 'app-chat',
  imports: [PlaceholderPage],
  template: `<app-placeholder-page title="Czat z Claude" description="Propozycje posiłków pod pozostałe kcal i Twoje składniki." [stage]="5" />`,
})
export class ChatPage {}
