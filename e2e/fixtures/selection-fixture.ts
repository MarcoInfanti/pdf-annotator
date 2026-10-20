import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';

/** Lines drawn on each page, top to bottom. Every line starts with a unique sentinel word. */
export const PAGE_ONE_LINES = [
  'ALPHA first line of text',
  'BRAVO second line of text',
  'CHARLIE third line of text',
  'DELTA fourth line of text',
  'ECHO fifth line of text',
] as const;
export const PAGE_TWO_LINES = ['FOXTROT page two first line', 'GOLF page two second line'] as const;

/** Two small pages (360 x 200 pt) so both fit in the viewport at the default 125 % zoom. */
export async function buildSelectionFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of [PAGE_ONE_LINES, PAGE_TWO_LINES]) {
    drawLines(doc.addPage([360, 200]), font, lines);
  }
  return doc.save();
}

/** One drawText per line so pdf.js produces one span per line plus a br at each line end. */
function drawLines(page: PDFPage, font: PDFFont, lines: readonly string[]): void {
  lines.forEach((line, i) => page.drawText(line, { x: 30, y: 170 - 25 * i, size: 12, font }));
}
