import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReadingModeService } from './reading-mode.service';

const KEY = 'pdf-annotations.reading-mode';

describe('ReadingModeService', () => {
  function create(): ReadingModeService {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    return TestBed.inject(ReadingModeService);
  }

  afterEach(() => {
    localStorage.removeItem(KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to normal when storage is empty', () => {
    expect(create().mode()).toBe('normal');
  });

  it('defaults to normal when the stored value is invalid', () => {
    localStorage.setItem(KEY, 'purple');

    expect(create().mode()).toBe('normal');
  });

  it('restores a stored mode', () => {
    localStorage.setItem(KEY, 'sepia');

    expect(create().mode()).toBe('sepia');
  });

  it('persists the chosen mode and maps night to the dark theme', () => {
    const service = create();

    service.set('night');
    TestBed.tick();

    expect(localStorage.getItem(KEY)).toBe('night');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('maps sepia to the sepia theme and normal removes the attribute', () => {
    const service = create();

    service.set('sepia');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('sepia');

    service.set('normal');
    TestBed.tick();
    expect(document.documentElement.hasAttribute('data-theme')).toBeFalse();
  });
});
