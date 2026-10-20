import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SidebarWidthService } from './sidebar-width.service';

const KEY = 'pdf-annotations.sidebar-width';

describe('SidebarWidthService stored-width clamping (adversarial)', () => {
  let currentViewport = 1000;

  function create(viewport: number, stored?: string): SidebarWidthService {
    currentViewport = viewport;
    spyOnProperty(window, 'innerWidth', 'get').and.callFake(() => currentViewport);
    if (stored !== undefined) localStorage.setItem(KEY, stored);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    return TestBed.inject(SidebarWidthService);
  }

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  // viewport 1000 => maximum 700
  it('keeps a stored width exactly at the maximum', () => {
    expect(create(1000, '700').width()).toBe(700);
  });

  it('clamps a stored width one pixel above the maximum', () => {
    expect(create(1000, '701').width()).toBe(700);
  });

  it('keeps a stored width exactly at the minimum', () => {
    expect(create(1000, '260').width()).toBe(260);
  });

  it('falls back to the default just below the minimum, fractions included', () => {
    expect(create(1000, '259.99').width()).toBe(380);
  });

  it('rounds a fractional stored width', () => {
    expect(create(1000, '300.5').width()).toBe(301);
  });

  it('clamps and rounds a fractional width above the maximum', () => {
    expect(create(1000, '700.4').width()).toBe(700);
  });

  for (const bad of ['-300', 'NaN', '', ' ', 'abc']) {
    it(`falls back to the default for the stored value "${bad}"`, () => {
      expect(create(1000, bad).width()).toBe(380);
    });
  }

  it('clamps Infinity to the maximum', () => {
    expect(create(1000, 'Infinity').width()).toBe(700);
  });

  it('does not write back the clamped width until the user resizes', () => {
    create(1000, '5000');

    expect(localStorage.getItem(KEY)).toBe('5000');
  });

  it('never exceeds the maximum when 70 % of the viewport is below the minimum', () => {
    // viewport 300 => maximum 210 < minimum 260; the stored 500 must not come back as 260 or more
    const service = create(300, '500');

    expect(service.width()).toBeLessThanOrEqual(service.maxWidth());
  });

  it('setWidth never exceeds the maximum when 70 % of the viewport is below the minimum', () => {
    const service = create(300);

    service.setWidth(400);

    expect(service.width()).toBeLessThanOrEqual(service.maxWidth());
  });

  function resizeTo(viewport: number): void {
    currentViewport = viewport;
    window.dispatchEvent(new Event('resize'));
  }

  it('re-clamps the width live when the viewport shrinks', () => {
    const service = create(1000, '700');

    resizeTo(600);

    expect(service.maxWidth()).toBe(420);
    expect(service.width()).toBeLessThanOrEqual(service.maxWidth());
    expect(service.width()).toBe(420);
  });

  it('restores the chosen width when the viewport grows back', () => {
    const service = create(1000, '700');

    resizeTo(600);
    resizeTo(1000);

    expect(service.maxWidth()).toBe(700);
    expect(service.width()).toBe(700);
  });

  it('does not rewrite the stored width on a resize', () => {
    const service = create(1000, '700');

    resizeTo(600);
    expect(service.width()).toBe(420);

    expect(localStorage.getItem(KEY)).toBe('700');
  });

  it('stops following resizes once the service is destroyed', () => {
    const service = create(1000, '700');

    TestBed.resetTestingModule();
    resizeTo(600);

    expect(service.maxWidth()).toBe(700);
  });
});
