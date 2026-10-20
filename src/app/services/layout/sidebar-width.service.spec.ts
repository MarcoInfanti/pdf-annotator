import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SidebarWidthService } from './sidebar-width.service';

const KEY = 'pdf-annotations.sidebar-width';

describe('SidebarWidthService', () => {
  function create(): SidebarWidthService {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    return TestBed.inject(SidebarWidthService);
  }

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('defaults to 380 when storage is empty', () => {
    expect(create().width()).toBe(380);
  });

  it('restores a stored width of at least the minimum', () => {
    localStorage.setItem(KEY, '300');

    expect(create().width()).toBe(300);
  });

  it('falls back to 380 for a stored width below the minimum', () => {
    localStorage.setItem(KEY, '100');
    expect(create().width()).toBe(380);
  });

  it('falls back to 380 when the stored value is not a number', () => {
    localStorage.setItem(KEY, 'wide');

    expect(create().width()).toBe(380);
  });

  it('clamps a too-small width to the minimum', () => {
    const service = create();

    service.setWidth(100);

    expect(service.width()).toBe(260);
  });

  it('clamps a too-large width to 70% of the viewport', () => {
    const service = create();

    service.setWidth(99999);

    expect(service.width()).toBe(Math.round(window.innerWidth * 0.7));
    expect(service.maxWidth()).toBe(Math.round(window.innerWidth * 0.7));
  });

  it('rounds the width', () => {
    const service = create();

    service.setWidth(300.6);

    expect(service.width()).toBe(301);
  });

  it('persists the width', () => {
    create().setWidth(320);

    expect(localStorage.getItem(KEY)).toBe('320');
  });

  it('resets to 380 and persists it', () => {
    const service = create();
    service.setWidth(500);

    service.reset();

    expect(service.width()).toBe(380);
    expect(localStorage.getItem(KEY)).toBe('380');
  });

  describe('when the viewport resizes', () => {
    let viewport = 1000;

    function createAt(width: number, stored?: string): SidebarWidthService {
      viewport = width;
      spyOnProperty(window, 'innerWidth', 'get').and.callFake(() => viewport);
      if (stored !== undefined) localStorage.setItem(KEY, stored);
      return create();
    }

    function resizeTo(width: number): void {
      viewport = width;
      window.dispatchEvent(new Event('resize'));
    }

    it('re-clamps the displayed width and maxWidth when the viewport shrinks', () => {
      const service = createAt(1000, '700');

      resizeTo(600);

      expect(service.maxWidth()).toBe(420);
      expect(service.width()).toBe(420);
    });

    it('returns to the chosen width when the viewport grows again', () => {
      const service = createAt(1000, '700');

      resizeTo(600);
      resizeTo(1000);

      expect(service.width()).toBe(700);
    });

    it('does not overwrite the stored width on resize', () => {
      createAt(1000, '700');

      resizeTo(600);

      expect(localStorage.getItem(KEY)).toBe('700');
    });

    it('stops listening when the service is destroyed', () => {
      const service = createAt(1000, '700');
      TestBed.resetTestingModule();

      resizeTo(600);

      expect(service.maxWidth()).toBe(700);
    });
  });

  it('updates the width without throwing when storage is unavailable', () => {
    const service = create();
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');

    expect(() => {
      service.setWidth(400);
    }).not.toThrow();
    expect(service.width()).toBe(400);
  });
});
