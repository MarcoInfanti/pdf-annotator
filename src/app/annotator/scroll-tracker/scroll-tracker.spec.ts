import { preferredScrollBehavior, SCROLL_SETTLE_MS, ScrollTracker } from './scroll-tracker';

describe('ScrollTracker', () => {
  let host: HTMLElement;
  let settled: jasmine.Spy;
  let controller: AbortController;
  let tracker: ScrollTracker;

  /** Fires `count` scroll events 16 ms apart. */
  function scrollFor(count: number): void {
    for (let i = 0; i < count; i++) {
      host.dispatchEvent(new Event('scroll'));
      jasmine.clock().tick(16);
    }
  }

  beforeEach(() => {
    jasmine.clock().install();
    host = document.createElement('div');
    settled = jasmine.createSpy('settled');
    controller = new AbortController();
    tracker = new ScrollTracker(host, settled);
    tracker.listen(controller.signal);
  });

  afterEach(() => {
    controller.abort();
    jasmine.clock().uninstall();
  });

  it('does not report a scroll nobody armed', () => {
    scrollFor(5);
    jasmine.clock().tick(1000);

    expect(settled).not.toHaveBeenCalled();
  });

  it('reports a long armed stream once, 150 ms after the last event', () => {
    tracker.arm();

    scrollFor(37);
    jasmine.clock().tick(SCROLL_SETTLE_MS - 16 - 1);
    expect(settled).not.toHaveBeenCalled();
    jasmine.clock().tick(1);

    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('is armed by a wheel, a pointer, a touch and a key press', () => {
    const arming: Event[] = [
      new WheelEvent('wheel'),
      new Event('pointerdown'),
      new Event('touchstart'),
    ];
    for (const event of arming) {
      const spy = jasmine.createSpy();
      const own = new AbortController();
      const element = document.createElement('div');
      new ScrollTracker(element, spy).listen(own.signal);

      element.dispatchEvent(event);
      element.dispatchEvent(new Event('scroll'));
      jasmine.clock().tick(SCROLL_SETTLE_MS);

      expect(spy).toHaveBeenCalledTimes(1);
      own.abort();
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    host.dispatchEvent(new Event('scroll'));
    jasmine.clock().tick(SCROLL_SETTLE_MS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('is not armed by Ctrl or Cmd + wheel, which zoom', () => {
    host.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true }));
    host.dispatchEvent(new WheelEvent('wheel', { metaKey: true }));

    scrollFor(3);
    jasmine.clock().tick(1000);

    expect(settled).not.toHaveBeenCalled();
  });

  it('stops reporting after disarm, including a report already pending', () => {
    tracker.arm();
    host.dispatchEvent(new Event('scroll'));

    tracker.disarm();
    jasmine.clock().tick(1000);
    scrollFor(3);
    jasmine.clock().tick(1000);

    expect(settled).not.toHaveBeenCalled();
  });

  it('removes its listeners when the signal aborts', () => {
    controller.abort();

    host.dispatchEvent(new Event('pointerdown'));
    scrollFor(3);
    jasmine.clock().tick(1000);

    expect(settled).not.toHaveBeenCalled();
  });
});

describe('preferredScrollBehavior', () => {
  function reducedMotion(matches: boolean): void {
    spyOn(window, 'matchMedia').and.returnValue({ matches } as MediaQueryList);
  }

  it('jumps instantly under reduced motion', () => {
    reducedMotion(true);

    expect(preferredScrollBehavior()).toBe('auto');
  });

  it('scrolls smoothly otherwise', () => {
    reducedMotion(false);

    expect(preferredScrollBehavior()).toBe('smooth');
  });

  it('scrolls smoothly where matchMedia is missing', () => {
    spyOn(window, 'matchMedia');
    (window as { matchMedia?: unknown }).matchMedia = undefined;

    expect(preferredScrollBehavior()).toBe('smooth');
  });
});
