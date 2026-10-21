import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AutosavePreferenceService } from './autosave-preference.service';

const KEY = 'pdf-annotations.autosave';

describe('AutosavePreferenceService', () => {
  function create(): AutosavePreferenceService {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    return TestBed.inject(AutosavePreferenceService);
  }

  afterEach(() => localStorage.removeItem(KEY));

  it('is on by default', () => {
    expect(create().enabled()).toBeTrue();
  });

  it("reads a stored 'false' as off", () => {
    localStorage.setItem(KEY, 'false');

    expect(create().enabled()).toBeFalse();
  });

  it('reads anything else as on', () => {
    localStorage.setItem(KEY, 'garbage');

    expect(create().enabled()).toBeTrue();
  });

  it('persists the choice', () => {
    const service = create();

    service.set(false);
    expect(localStorage.getItem(KEY)).toBe('false');
    service.set(true);
    expect(localStorage.getItem(KEY)).toBe('true');
    expect(service.enabled()).toBeTrue();
  });

  it('starts on when the stored value cannot be read', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');

    expect(create().enabled()).toBeTrue();
  });

  it('still updates the value when storing it fails', () => {
    const service = create();
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

    service.set(false);

    expect(service.enabled()).toBeFalse();
  });
});
