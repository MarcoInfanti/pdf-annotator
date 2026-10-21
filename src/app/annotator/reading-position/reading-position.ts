import type {
  PageExtent,
  PageRotation,
  PageHit,
  PdfViewport,
  ReadingPosition,
  ViewerPosition,
} from '../../models/annotator.model';

/** Tolerance, in user-space units, when deciding that a position is the document start. */
const START_TOLERANCE = 1;

/**
 * Finds the page holding a scroll offset. A gap or the padding above a page counts as that next
 * page at offset 0; past the last page it is the last page at its full height.
 *
 * @param pages Page extents ordered from the top.
 */
export function locatePage(scrollTop: number, pages: PageExtent[]): PageHit | null {
  for (const [index, page] of pages.entries()) {
    if (scrollTop < page.top) return { index, offset: 0 };
    if (scrollTop < page.top + page.height) return { index, offset: scrollTop - page.top };
  }
  const last = pages.at(-1);
  return last ? { index: pages.length - 1, offset: last.height } : null;
}

/** Validates untrusted data (JSON from localStorage or the PDF) as a reading position; never throws. */
export function parseReadingPosition(value: unknown): ReadingPosition | null {
  if (typeof value !== 'object' || value === null) return null;
  const { page, x, y, zoom, updatedAt } = value as Record<string, unknown>;
  if (!isPositiveInteger(page) || !isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(zoom) || zoom <= 0) return null;
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return null;
  return { page, x, y, zoom, updatedAt };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

/** Picks the more recent of two positions; a tie goes to the embedded (PDF) one. */
export function newerPosition(
  stored: ReadingPosition | null,
  embedded: ReadingPosition | null,
): ReadingPosition | null {
  if (!stored || !embedded) return stored ?? embedded;
  return Date.parse(stored.updatedAt) > Date.parse(embedded.updatedAt) ? stored : embedded;
}

/** Whether a position is, within a unit, the top of page 1 as measured by the viewer. */
export function isDocumentStart(position: ViewerPosition, start: ViewerPosition): boolean {
  return (
    position.page === 1 &&
    start.page === 1 &&
    Math.abs(position.x - start.x) <= START_TOLERANCE &&
    Math.abs(position.y - start.y) <= START_TOLERANCE
  );
}

/** Reduces any angle (negative or past a full turn) to 0, 90, 180 or 270. */
export function normalizeRotation(degrees: number): PageRotation {
  const turn = ((degrees % 360) + 360) % 360;
  return turn === 90 || turn === 180 || turn === 270 ? turn : 0;
}

/**
 * The axis of the user-space point that decides where a page opens vertically on screen: y for
 * upright pages, x once the page is turned sideways.
 */
export function openActionAxis(rotation: PageRotation): 'x' | 'y' {
  return rotation === 90 || rotation === 270 ? 'x' : 'y';
}

/** The user-space point under the viewport's top-left corner; rotation and CropBox are pdf.js' job. */
export function viewportStart(viewport: PdfViewport, page: number): ViewerPosition {
  const [x, y] = viewport.convertToPdfPoint(0, 0) as number[];
  return { page, x, y };
}
