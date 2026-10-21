import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Annotation, ReadingPosition } from '../../models/annotator.model';
import { SessionStorageService } from './session-storage.service';

const IDENTITY = { name: 'a.pdf', pageCount: 2 };
const POSITION_KEY = 'pdf-annotations.position.a.pdf|2';
const RECOVERY_KEY = 'pdf-annotations.recovery.a.pdf|2';
const BASELINE = { size: 100, lastModified: 5 };

function annotation(id: string): Annotation {
  return {
    id,
    page: 1,
    rects: [[0, 0, 10, 10]],
    quote: 'q',
    comment: 'c',
    color: '#ffd54f',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

const POSITION: ReadingPosition = {
  page: 2,
  x: 10,
  y: 20,
  zoom: 1.5,
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('SessionStorageService', () => {
  let service: SessionStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(SessionStorageService);
  });

  afterEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith('pdf-annotations.position.') ||
        key.startsWith('pdf-annotations.recovery.')
      ) {
        localStorage.removeItem(key);
      }
    }
  });

  it('round-trips a reading position under its own key', () => {
    service.writePosition(IDENTITY, POSITION);

    expect(localStorage.getItem(POSITION_KEY)).not.toBeNull();
    expect(service.readPosition(IDENTITY)).toEqual(POSITION);
  });

  it('round-trips a recovery copy with its baseline', () => {
    service.writeRecovery(IDENTITY, [annotation('a')], BASELINE);

    expect(localStorage.getItem(RECOVERY_KEY)).not.toBeNull();
    expect(service.readRecovery(IDENTITY)).toEqual({
      baseline: BASELINE,
      annotations: [annotation('a')],
    });
  });

  it('keeps documents with the same name and a different page count apart', () => {
    service.writePosition({ name: 'a.pdf', pageCount: 2 }, POSITION);
    service.writeRecovery({ name: 'a.pdf', pageCount: 2 }, [annotation('a')], BASELINE);

    expect(service.readPosition({ name: 'a.pdf', pageCount: 3 })).toBeNull();
    expect(service.readRecovery({ name: 'a.pdf', pageCount: 3 })).toBeNull();
  });

  it('reads corrupt data as null', () => {
    localStorage.setItem(POSITION_KEY, 'not json');
    expect(service.readPosition(IDENTITY)).toBeNull();
    localStorage.setItem(POSITION_KEY, '{"page":0}');
    expect(service.readPosition(IDENTITY)).toBeNull();

    const corrupt = ['not json', '{}', '{"baseline":{"size":1},"annotations":"{}"}'];
    for (const value of corrupt) {
      localStorage.setItem(RECOVERY_KEY, value);
      expect(service.readRecovery(IDENTITY)).toBeNull();
    }
  });

  it('clears a recovery copy', () => {
    service.writeRecovery(IDENTITY, [annotation('a')], BASELINE);

    service.clearRecovery(IDENTITY);

    expect(service.readRecovery(IDENTITY)).toBeNull();
  });

  it('does not throw when the quota is exceeded', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

    expect(() => service.writePosition(IDENTITY, POSITION)).not.toThrow();
    expect(() => service.writeRecovery(IDENTITY, [], BASELINE)).not.toThrow();
  });

  it('reads null when storage cannot be read', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');

    expect(service.readPosition(IDENTITY)).toBeNull();
    expect(service.readRecovery(IDENTITY)).toBeNull();
  });

  it('does not throw when clearing fails', () => {
    const removeItem = spyOn(Storage.prototype, 'removeItem').and.throwError('SecurityError');

    expect(() => service.clearRecovery(IDENTITY)).not.toThrow();

    // The cleanup after the spec removes keys through the same method
    removeItem.and.callThrough();
  });
});
