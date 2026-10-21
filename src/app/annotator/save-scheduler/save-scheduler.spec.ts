import type { SchedulerTimers } from '../../models/annotator.model';
import { SaveScheduler } from './save-scheduler';

/** A manual clock: `advance` runs the timers that come due, in order. */
class FakeTimers implements SchedulerTimers {
  private time = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(id: number): void {
    this.tasks.delete(id);
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = target;
  }
}

describe('SaveScheduler', () => {
  let timers: FakeTimers;
  let fire: jasmine.Spy;
  let scheduler: SaveScheduler;

  beforeEach(() => {
    timers = new FakeTimers();
    fire = jasmine.createSpy('fire');
    scheduler = new SaveScheduler(fire, timers);
  });

  it('fires 3 s after a change, and not before', () => {
    scheduler.schedule();

    timers.advance(2999);
    expect(fire).not.toHaveBeenCalled();
    timers.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires once for a burst of changes, 3 s after the last one', () => {
    scheduler.schedule();
    timers.advance(2000);
    scheduler.schedule();
    timers.advance(2000);
    scheduler.schedule();

    timers.advance(2999);
    expect(fire).not.toHaveBeenCalled();
    timers.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires at the 30 s max wait when changes keep arriving every 2 s', () => {
    for (let elapsed = 0; elapsed < 30000; elapsed += 2000) {
      scheduler.schedule();
      timers.advance(2000);
    }
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('does not fire after cancel', () => {
    scheduler.schedule();
    scheduler.cancel();

    timers.advance(60000);

    expect(fire).not.toHaveBeenCalled();
  });

  it('doubles the last duration into the delay', () => {
    scheduler.recordDuration(2500);
    scheduler.schedule();

    timers.advance(4999);
    expect(fire).not.toHaveBeenCalled();
    timers.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('caps the delay at 30 s', () => {
    scheduler.recordDuration(20000);
    scheduler.schedule();

    timers.advance(29999);
    expect(fire).not.toHaveBeenCalled();
    timers.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('never goes below 3 s for a fast save', () => {
    scheduler.recordDuration(100);
    scheduler.schedule();

    timers.advance(2999);
    expect(fire).not.toHaveBeenCalled();
    timers.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh max-wait window after firing', () => {
    scheduler.schedule();
    timers.advance(3000);
    scheduler.schedule();

    timers.advance(3000);

    expect(fire).toHaveBeenCalledTimes(2);
  });
});
