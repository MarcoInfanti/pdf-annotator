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

  it('updates the width without throwing when storage is unavailable', () => {
    const service = create();
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');

    expect(() => {
      service.setWidth(400);
    }).not.toThrow();
    expect(service.width()).toBe(400);
  });
});
