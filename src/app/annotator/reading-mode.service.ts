import { effect, Injectable, signal } from '@angular/core';

export type ReadingMode = 'normal' | 'sepia' | 'night';

export const READING_MODES: { value: ReadingMode; label: string; icon: string }[] = [
  { value: 'normal', label: 'Normal', icon: '☀' },
  { value: 'sepia', label: 'Sepia', icon: '☕' },
  { value: 'night', label: 'Noche', icon: '☾' },
];

const STORAGE_KEY = 'pdf-annotations.reading-mode';

/**
 * Tints the pages and the whole UI to reduce glare. Applied as `data-theme` on <html>;
 * the colors and page filters live in styles.scss.
 */
@Injectable({ providedIn: 'root' })
export class ReadingModeService {
  private readonly _mode = signal<ReadingMode>(readStoredMode());
  readonly mode = this._mode.asReadonly();

  constructor() {
    effect(() => {
      const mode = this._mode();
      const root = document.documentElement;
      if (mode === 'normal') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode === 'night' ? 'dark' : 'sepia');
    });
  }

  set(mode: ReadingMode): void {
    this._mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (private mode): the mode just isn't remembered.
    }
  }
}

function readStoredMode(): ReadingMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return READING_MODES.some((m) => m.value === stored) ? (stored as ReadingMode) : 'normal';
  } catch {
    return 'normal';
  }
}
