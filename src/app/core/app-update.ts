import { Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { ToastController } from '@ionic/angular';
import { filter } from 'rxjs';

/**
 * Aktualizacje PWA: po wdrożeniu nowej wersji pokazuje komunikat „Odśwież”.
 * Sprawdza nowe wersje przy każdym powrocie do aplikacji.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly sw = inject(SwUpdate);
  private readonly toast = inject(ToastController);

  init(): void {
    if (!this.sw.isEnabled) return;
    this.sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => void this.prompt());
    this.sw.unrecoverable.subscribe(() => document.location.reload());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sw.checkForUpdate().catch(() => undefined);
    });
  }

  private async prompt(): Promise<void> {
    const t = await this.toast.create({
      message: 'Jest nowa wersja MenuVibe.',
      position: 'bottom',
      color: 'dark',
      buttons: [{ text: 'Odśwież', handler: () => document.location.reload() }],
    });
    await t.present();
  }
}
