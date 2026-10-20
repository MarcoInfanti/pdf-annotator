import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

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
  private readonly viewportWidth = signal(window.innerWidth);

  /** The width the user chose; a resize never rewrites it, so a wider viewport restores it. */
  private readonly chosenWidth = signal(this.readStored());

  /** Lower bound, for the resizer's `aria-valuemin`. */
  readonly minWidth = MIN_WIDTH;

  /** Upper bound in px; follows the viewport live. */
  readonly maxWidth = computed(() => Math.round(this.viewportWidth() * MAX_VIEWPORT_SHARE));

  /** Width in px being displayed: the chosen width clamped to the current bounds. */
  readonly width = computed(() => this.clamp(this.chosenWidth()));

  constructor() {
    const controller = new AbortController();
    window.addEventListener('resize', () => this.viewportWidth.set(window.innerWidth), {
      signal: controller.signal,
    });
    inject(DestroyRef).onDestroy(() => controller.abort());
  }

  /** Clamps to `[minWidth, maxWidth()]`, rounds, applies and remembers the width. */
  setWidth(px: number): void {
    const clamped = this.clamp(px);
    this.chosenWidth.set(clamped);
    this.persist(clamped);
  }

  /** Back to the default width. */
  reset(): void {
    this.setWidth(DEFAULT_WIDTH);
  }

  private clamp(px: number): number {
    return Math.round(Math.min(Math.max(px, MIN_WIDTH), this.maxWidth()));
  }

  private readStored(): number {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      // Not clamped to the viewport here: `width` does that, so a wider viewport restores it.
      return stored >= MIN_WIDTH ? Math.round(stored) : DEFAULT_WIDTH;
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
