import type { PageExtent, PdfViewport, ReadingPosition } from '../../models/annotator.model';
import {
  isDocumentStart,
  locatePage,
  newerPosition,
  normalizeRotation,
  openActionAxis,
  parseReadingPosition,
  viewportStart,
} from './reading-position';

function position(overrides: Partial<ReadingPosition> = {}): ReadingPosition {
  return { page: 2, x: 10, y: 20, zoom: 1.25, updatedAt: '2024-01-01T00:00:00.000Z', ...overrides };
}

describe('locatePage', () => {
  const pages: PageExtent[] = [
    { top: 16, height: 100 },
    { top: 132, height: 100 },
  ];

  it('returns null without pages', () => {
    expect(locatePage(50, [])).toBeNull();
  });

  it('puts the padding above the first page at offset 0 of the first page', () => {
    expect(locatePage(5, pages)).toEqual({ index: 0, offset: 0 });
  });

  it('puts a gap between pages at offset 0 of the next page', () => {
    expect(locatePage(120, pages)).toEqual({ index: 1, offset: 0 });
  });

  it('returns the page and the offset inside it', () => {
    expect(locatePage(60, pages)).toEqual({ index: 0, offset: 44 });
    expect(locatePage(132, pages)).toEqual({ index: 1, offset: 0 });
  });

  it('returns the last page at its full height past the end', () => {
    expect(locatePage(5000, pages)).toEqual({ index: 1, offset: 100 });
  });
});

describe('parseReadingPosition', () => {
  it('accepts a valid position', () => {
    expect(parseReadingPosition(position())).toEqual(position());
  });

  it('rejects anything that is not a full position', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'text',
      42,
      [],
      { ...position(), x: undefined },
      { ...position(), y: undefined },
      position({ x: NaN }),
      position({ y: Infinity }),
      position({ page: 0 }),
      position({ page: 1.5 }),
      position({ zoom: 0 }),
      position({ updatedAt: 'not a date' }),
      { ...position(), updatedAt: 5 },
    ];

    for (const value of bad) expect(parseReadingPosition(value)).toBeNull();
  });
});

describe('newerPosition', () => {
  const older = position({ updatedAt: '2024-01-01T00:00:00.000Z', x: 1 });
  const newer = position({ updatedAt: '2024-02-01T00:00:00.000Z', x: 2 });

  it('returns the one that exists', () => {
    expect(newerPosition(older, null)).toBe(older);
    expect(newerPosition(null, older)).toBe(older);
    expect(newerPosition(null, null)).toBeNull();
  });

  it('returns the later one in either order', () => {
    expect(newerPosition(newer, older)).toBe(newer);
    expect(newerPosition(older, newer)).toBe(newer);
  });

  it('gives a tie to the embedded position', () => {
    const stored = position({ x: 1 });
    const embedded = position({ x: 2 });

    expect(newerPosition(stored, embedded)).toBe(embedded);
  });
});

describe('isDocumentStart', () => {
  const start = { page: 1, x: 0, y: 800 };

  it('is true at the start, within one unit', () => {
    expect(isDocumentStart(position({ page: 1, x: 0.5, y: 799.5 }), start)).toBeTrue();
  });

  it('is false two units off on either axis', () => {
    expect(isDocumentStart(position({ page: 1, x: 2, y: 800 }), start)).toBeFalse();
    expect(isDocumentStart(position({ page: 1, x: 0, y: 798 }), start)).toBeFalse();
  });

  it('is false for another page', () => {
    expect(isDocumentStart(position({ page: 2, x: 0, y: 800 }), start)).toBeFalse();
  });
});

describe('rotation', () => {
  it('normalises any angle to 0, 90, 180 or 270', () => {
    const cases: [number, number][] = [
      [0, 0],
      [90, 90],
      [180, 180],
      [270, 270],
      [-90, 270],
      [450, 90],
      [720, 0],
    ];

    for (const [input, expected] of cases) expect(normalizeRotation(input)).toBe(expected as 0);
  });

  it('uses the y axis for upright pages and the x axis for sideways ones', () => {
    expect(openActionAxis(0)).toBe('y');
    expect(openActionAxis(180)).toBe('y');
    expect(openActionAxis(90)).toBe('x');
    expect(openActionAxis(270)).toBe('x');
  });
});

describe('viewportStart', () => {
  /** A viewport whose convertToPdfPoint(0, 0) is the given user-space point. */
  function viewportAt(x: number, y: number): PdfViewport {
    return { convertToPdfPoint: () => [x, y] } as unknown as PdfViewport;
  }

  it('reads the user-space point under the top-left corner for every rotation', () => {
    // Unrotated A4 has its top-left at (0, 842); each quarter turn moves it to another corner
    const corners: [number, number][] = [
      [0, 842],
      [0, 0],
      [595, 0],
      [595, 842],
    ];

    for (const [x, y] of corners) {
      expect(viewportStart(viewportAt(x, y), 1)).toEqual({ page: 1, x, y });
    }
  });

  it('keeps the offset of a CropBox that does not start at the origin', () => {
    expect(viewportStart(viewportAt(36, 806), 3)).toEqual({ page: 3, x: 36, y: 806 });
  });
});
