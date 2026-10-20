import { Injectable, signal } from '@angular/core';

/** Width in px when nothing valid is stored. */
const DEFAULT_WIDTH = 380;

/** Narrowest the sidebar may get, in px. */
const MIN_WIDTH = 260;

/** Fraction of the viewport width the sidebar may take at most. */
const MAX_VIEWPORT_SHARE = 0.7;

/** localStorage key of the remembered width. */
const STORAGE_KEY = 'pdf-annotations.sidebar-width';

/** The annotation sidebar's width: clamped, rounded and remembered across visits. */
@Injectable({ providedIn: 'root' })
export class SidebarWidthService {
  private readonly _width = signal(this.readStored());

  /** Lower bound, for the resizer's `aria-valuemin`. */
  readonly minWidth = MIN_WIDTH;

  /** Current width in px. */
  readonly width = this._width.asReadonly();

  /** Upper bound in px; depends on the viewport, so it is read when needed. */
  maxWidth(): number {
    return Math.round(window.innerWidth * MAX_VIEWPORT_SHARE);
  }

  /** Clamps to `[minWidth, maxWidth()]`, rounds, applies and remembers the width. */
  setWidth(px: number): void {
    const clamped = Math.round(Math.min(Math.max(px, MIN_WIDTH), this.maxWidth()));
    this._width.set(clamped);
    this.persist(clamped);
  }

  /** Back to the default width. */
  reset(): void {
    this.setWidth(DEFAULT_WIDTH);
  }

  private readStored(): number {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      return stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  }

  private persist(width: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Storage unavailable (private mode): the width just isn't remembered.
    }
  }
}
