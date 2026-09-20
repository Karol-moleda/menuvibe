import { Component, ElementRef, OnDestroy, afterNextRender, output, signal, viewChild } from '@angular/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonText, IonTitle, IonToolbar } from '@ionic/angular';

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * Skaner kodów kreskowych w przeglądarce (PWA): aparat + BarcodeDetector.
 * Chrome na Androidzie ma BarcodeDetector wbudowany; gdzie go brak, ładujemy zapasowy moduł (ZXing, WebAssembly).
 */
@Component({
  selector: 'app-web-scanner',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonText],
  host: { style: 'display: contents' },
  template: `
    <ion-header>
      <ion-toolbar color="dark">
        <ion-title>Skanuj kod</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="closed.emit(null)">Zamknij</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content color="dark">
      <div class="stage">
        <video #video playsinline muted></video>
        <div class="frame" aria-hidden="true"></div>
      </div>
      <ion-text color="light">
        <p class="hint">{{ error() ?? 'Nakieruj aparat na kod kreskowy na opakowaniu.' }}</p>
      </ion-text>
    </ion-content>
  `,
  styles: `
    .stage { position: relative; width: 100%; aspect-ratio: 3 / 4; background: #000; overflow: hidden; }
    video { width: 100%; height: 100%; object-fit: cover; }
    .frame {
      position: absolute; left: 10%; right: 10%; top: 35%; height: 30%;
      border: 3px solid var(--ion-color-primary); border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
    }
    .hint { text-align: center; padding: 16px; }
  `,
})
export class WebScannerComponent implements OnDestroy {
  /** kod albo null (anulowano) */
  readonly closed = output<string | null>();
  protected readonly error = signal<string | null>(null);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private stopped = false;

  constructor() {
    afterNextRender(() => void this.start());
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private async start(): Promise<void> {
    try {
      const detector = await createDetector();
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      const video = this.video().nativeElement;
      video.srcObject = this.stream;
      await video.play();
      this.loop(detector, video);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      this.error.set(
        name === 'NotAllowedError'
          ? 'Brak zgody na aparat. Zezwól na aparat w ustawieniach strony i spróbuj ponownie.'
          : name === 'NotFoundError'
            ? 'Nie znaleziono aparatu.'
            : 'Nie udało się uruchomić skanera. Wpisz kod EAN w wyszukiwarkę.',
      );
    }
  }

  private loop(detector: Detector, video: HTMLVideoElement): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        if (video.readyState >= 2) {
          const found = await detector.detect(video);
          const code = found.find((b) => /^\d{8,14}$/.test(b.rawValue))?.rawValue;
          if (code) {
            navigator.vibrate?.(80);
            this.stop();
            this.closed.emit(code);
            return;
          }
        }
      } catch {
        // pojedyncza nieudana klatka – próbujemy dalej
      }
      setTimeout(() => void tick(), 180);
    };
    void tick();
  }

  private stop(): void {
    this.stopped = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

async function createDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } })
    .BarcodeDetector;
  if (native) {
    const supported = await native.getSupportedFormats().catch(() => [] as string[]);
    if (FORMATS.some((f) => supported.includes(f))) return new native({ formats: FORMATS.filter((f) => supported.includes(f)) });
  }
  // zapasowo: ZXing w WebAssembly, plik .wasm serwowany z naszej domeny
  const mod = await import('barcode-detector/ponyfill');
  mod.setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? 'zxing/zxing_reader.wasm' : prefix + path),
  });
  return new mod.BarcodeDetector({ formats: FORMATS as never });
}
