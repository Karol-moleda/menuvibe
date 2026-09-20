import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ToastController,
  ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { bookmark, bookmarkOutline, calendarOutline, checkmarkOutline, chevronDownOutline, chevronUpOutline, send, timeOutline, trashOutline } from 'ionicons/icons';
import { BodyStore } from '../../core/body.store';
import { ChatMessage, ChatStore, ProposedRecipe, cardKey } from '../../core/chat.store';
import { MealSlot } from '../../core/database.types';
import { DiaryStore } from '../../core/diary.store';
import { todayIso } from '../../core/nutrition';
import { PlanStore } from '../../core/plan.store';
import { SLOTS, SLOT_LABELS } from '../../core/planner';
import { RecipeSummary } from '../../core/recipe.store';

const SUGGESTIONS = [
  'Co zjeść na kolację z kalorii, które mi zostały?',
  'Mam kurczaka, ryż i paprykę – co zrobić na obiad?',
  'Szybkie śniadanie bez gotowania, dużo białka',
  'Słodka przekąska do 200 kcal',
];

@Component({
  selector: 'app-chat',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonTextarea,
    IonChip,
    IonSpinner,
  ],
  templateUrl: './chat.page.html',
  styleUrl: './chat.page.scss',
})
export class ChatPage implements ViewWillEnter {
  protected readonly chat = inject(ChatStore);
  private readonly body = inject(BodyStore);
  private readonly diary = inject(DiaryStore);
  private readonly plan = inject(PlanStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);
  private readonly alert = inject(AlertController);
  private readonly content = viewChild(IonContent);

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly suggestions = SUGGESTIONS;

  protected readonly draft = signal('');
  protected readonly slot = signal<MealSlot | null>(guessSlot());
  /** rozwinięte karty przepisów */
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly done = signal<Record<string, string[]>>({});

  protected readonly remaining = computed(() => {
    const t = this.body.currentTarget();
    return t ? t.kcal - this.diary.totals().kcal : null;
  });

  constructor() {
    addIcons({ send, trashOutline, bookmark, bookmarkOutline, checkmarkOutline, calendarOutline, timeOutline, chevronDownOutline, chevronUpOutline });
    // przewijanie na dół przy nowych wiadomościach
    effect(() => {
      this.chat.messages();
      setTimeout(() => void this.content()?.scrollToBottom(250), 50);
    });
  }

  ionViewWillEnter(): void {
    void this.chat.load().catch(() => undefined);
    if (this.diary.date() !== todayIso() || !this.diary.loaded()) void this.diary.load(todayIso()).catch(() => undefined);
  }

  async sendDraft(text = this.draft()): Promise<void> {
    if (!text.trim()) return;
    this.draft.set('');
    await this.chat.send(text, this.slot());
  }

  useSuggestion(text: string): void {
    void this.sendDraft(text);
  }

  onKeydown(event: KeyboardEvent): void {
    // Enter wysyła, Shift+Enter – nowa linia (na komputerze)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendDraft();
    }
  }

  cardKey(msg: ChatMessage, index: number): string {
    return cardKey(msg.id, index);
  }

  toggle(key: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  isDone(key: string, action: string): boolean {
    return this.done()[key]?.includes(action) ?? false;
  }

  isSaved(key: string): boolean {
    return this.chat.saved().has(key);
  }

  async save(key: string, r: ProposedRecipe): Promise<void> {
    await this.run(key, 'save', async () => {
      await this.ensureSaved(key, r);
    });
  }

  async eat(key: string, r: ProposedRecipe): Promise<void> {
    await this.run(key, 'eat', async () => {
      const recipe = await this.ensureSaved(key, r);
      if (this.diary.date() !== todayIso()) await this.diary.load(todayIso());
      await this.diary.addRecipe(recipe, r.slot, 1);
      await this.showToast(`Dodano do dziennika: ${r.name} (${Math.round(r.per_serving.kcal)} kcal)`);
    });
  }

  async planToday(key: string, r: ProposedRecipe): Promise<void> {
    await this.run(key, 'plan', async () => {
      const recipe = await this.ensureSaved(key, r);
      await this.plan.putOnDate(todayIso(), r.slot, recipe.id);
      await this.showToast(`Wstawiono do planu na dziś: ${SLOT_LABELS[r.slot].toLowerCase()}.`);
    });
  }

  async clear(): Promise<void> {
    const a = await this.alert.create({
      header: 'Wyczyścić rozmowę?',
      message: 'Zapisane przepisy zostaną w bazie.',
      buttons: [
        { text: 'Anuluj', role: 'cancel' },
        { text: 'Wyczyść', role: 'destructive', handler: () => void this.chat.clear() },
      ],
    });
    await a.present();
  }

  openRecipe(key: string): void {
    const saved = this.chat.saved().get(key);
    if (saved) void this.router.navigate(['/przepisy', saved.id]);
  }

  private ensureSaved(key: string, r: ProposedRecipe): Promise<RecipeSummary> {
    return this.chat.ensureSaved(key, r);
  }

  private markDone(key: string, action: string): void {
    this.done.update((d) => ({ ...d, [key]: [...new Set([...(d[key] ?? []), action])] }));
  }

  private async run(key: string, action: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.markDone(key, action);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      await this.showToast(`Błąd: ${msg}`, 'danger');
    }
  }

  private async showToast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toast.create({ message, duration: 2500, color, position: 'top' });
    await t.present();
  }
}

/** Domyślny posiłek wg pory dnia. */
function guessSlot(now = new Date()): MealSlot {
  const h = now.getHours();
  if (h < 10) return 'breakfast';
  if (h < 13) return 'snack';
  if (h < 17) return 'lunch';
  return 'dinner';
}
