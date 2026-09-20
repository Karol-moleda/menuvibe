import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

/** Skaner kodów kreskowych (Google ML Kit). Działa tylko w aplikacji na telefonie. */
@Injectable({ providedIn: 'root' })
export class ScannerService {
  readonly available = Capacitor.isNativePlatform();

  /** Otwiera ekran skanowania; zwraca kod albo null, gdy anulowano. */
  async scan(): Promise<string | null> {
    if (!this.available) return null;
    const { supported } = await BarcodeScanner.isSupported();
    if (!supported) throw new Error('Ten telefon nie obsługuje skanera kodów.');

    if (Capacitor.getPlatform() === 'android') {
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) {
        // moduł skanera pobiera się z Google Play przy pierwszym użyciu
        await BarcodeScanner.installGoogleBarcodeScannerModule();
        throw new Error('Pobieram moduł skanera z Google Play – spróbuj ponownie za chwilę.');
      }
    }

    try {
      const { barcodes } = await BarcodeScanner.scan({
        formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE],
      });
      return barcodes[0]?.rawValue ?? barcodes[0]?.displayValue ?? null;
    } catch (e) {
      // anulowanie skanowania przez użytkownika
      if (String((e as { message?: string })?.message ?? e).toLowerCase().includes('cancel')) return null;
      throw e;
    }
  }
}
