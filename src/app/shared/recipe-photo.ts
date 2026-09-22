import { Component, computed, input, signal } from '@angular/core';

/**
 * Zdjęcie potrawy z PDF-ów dietetyczek (public/img/recipes/<slug>.jpg).
 * Nie każdy przepis je ma – wtedy pokazujemy to, co jest w środku znacznika.
 */
@Component({
  selector: 'app-recipe-photo',
  template: `
    @if (src(); as url) {
      <img [src]="url" alt="" loading="lazy" decoding="async" (error)="failed.set(true)" />
    } @else {
      <ng-content />
    }
  `,
  styles: `
    :host {
      display: block;
      overflow: hidden;
      border-radius: 12px;
      background: var(--mv-soft);
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class RecipePhotoComponent {
  readonly slug = input<string | null | undefined>(null);
  protected readonly failed = signal(false);

  protected readonly src = computed(() => {
    const slug = this.slug();
    return slug && !this.failed() ? `img/recipes/${slug}.jpg` : null;
  });
}
