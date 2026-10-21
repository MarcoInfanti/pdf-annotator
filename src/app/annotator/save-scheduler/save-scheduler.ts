import type { SchedulerTimers } from '../../models/annotator.model';

/** Shortest wait between the last change and the autosave. */
export const AUTOSAVE_MIN_DELAY_MS = 3000;

/** Longest a pending change may wait, however often the document keeps changing. */
export const AUTOSAVE_MAX_WAIT_MS = 30000;

/** The real clock: `window` timers and `performance.now()`. */
export const BROWSER_TIMERS: SchedulerTimers = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  now: () => performance.now(),
};

/**
 * Trailing debounce for autosave. Each change restarts the timer, but the total wait since the
 * first pending change never exceeds `AUTOSAVE_MAX_WAIT_MS`. The delay adapts to how long the last
 * save took, so slow saves of big PDFs are not triggered back to back.
 */
export class SaveScheduler {
  private timer: number | null = null;
  private firstAt: number | null = null;
  private lastDuration = 0;

  constructor(
    private readonly fire: () => void,
    private readonly timers: SchedulerTimers = BROWSER_TIMERS,
  ) {}

  /** Registers a change: restarts the timer, bounded by the max wait counted from the first change. */
  schedule(): void {
    const now = this.timers.now();
    this.firstAt ??= now;
    this.clearTimer();
    const remaining = Math.max(0, AUTOSAVE_MAX_WAIT_MS - (now - this.firstAt));
    this.timer = this.timers.setTimeout(() => this.release(), Math.min(this.delay(), remaining));
  }

  /** Drops the pending save, if any. */
  cancel(): void {
    this.clearTimer();
    this.firstAt = null;
  }

  /** Remembers how long the last encode + write took (milliseconds), which stretches the next delay. */
  recordDuration(ms: number): void {
    this.lastDuration = ms;
  }

  /** `max(3 s, 2 x last duration)`, capped at 30 s. */
  private delay(): number {
    return Math.min(AUTOSAVE_MAX_WAIT_MS, Math.max(AUTOSAVE_MIN_DELAY_MS, 2 * this.lastDuration));
  }

  private release(): void {
    this.timer = null;
    this.firstAt = null;
    this.fire();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
