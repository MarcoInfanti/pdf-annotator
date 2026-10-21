/** How long the viewer must stop scrolling before its position counts as settled. */
export const SCROLL_SETTLE_MS = 150;

/**
 * Tells when the user has finished scrolling a container. Scrolls the app causes itself (loading a
 * document, a smooth jump) are ignored until a real user action arms the tracker, so only the
 * settled result of a deliberate scroll is reported. Raw passive listeners: no change detection runs.
 */
export class ScrollTracker {
  private armed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param host The scroll container.
   * @param settled Called once the container has been still for `settleMs` after an armed scroll.
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly settled: () => void,
    private readonly settleMs = SCROLL_SETTLE_MS,
  ) {}

  /** Starts listening; aborting the signal removes every listener and drops a pending report. */
  listen(signal: AbortSignal): void {
    const options = { passive: true, signal };
    this.host.addEventListener('scroll', () => this.restart(), options);
    this.host.addEventListener('wheel', (event) => this.armUnlessZooming(event), options);
    this.host.addEventListener('pointerdown', () => this.arm(), options);
    this.host.addEventListener('touchstart', () => this.arm(), options);
    document.addEventListener('keydown', () => this.arm(), options);
    signal.addEventListener('abort', () => this.clearTimer());
  }

  /** From now on, scrolling is reported: a user action (or a jump the user asked for) happened. */
  arm(): void {
    this.armed = true;
  }

  /** Stops reporting until the next arming event, and drops a report that is pending. */
  disarm(): void {
    this.armed = false;
    this.clearTimer();
  }

  /** Ctrl/Cmd + wheel zooms instead of scrolling, so it is not a reading action. */
  private armUnlessZooming(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) this.arm();
  }

  private restart(): void {
    this.clearTimer();
    if (!this.armed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.settled();
    }, this.settleMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * `'auto'` (an instant jump) under `prefers-reduced-motion: reduce`, otherwise `'smooth'`; also
 * `'smooth'` where `matchMedia` is missing. Only "Continuar" uses it.
 */
export function preferredScrollBehavior(): ScrollBehavior {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 'auto' : 'smooth';
}
