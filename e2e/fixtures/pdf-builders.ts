import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from 'pdf-lib';

/** Options of {@link buildReadingFixture}. */
export interface ReadingFixtureOptions {
  /** Number of pages; enough to scroll at the default zoom. */
  pages?: number;
  /** Rotation applied to every page. */
  rotation?: 0 | 90 | 180 | 270;
  /** Page size in points before rotation. */
  size?: [number, number];
  /** Crop box `[x, y, width, height]` applied to every page. */
  cropBox?: [number, number, number, number];
}

/** Defaults: six 400 x 600 pt pages, i.e. 500 x 750 px at the default zoom of 125 %. */
const DEFAULT_SIZE: [number, number] = [400, 600];

/** Builds a multi-page PDF tall enough to scroll, each page labelled `READING PAGE n`. */
export async function buildReadingFixture(
  options: ReadingFixtureOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [width, height] = options.size ?? DEFAULT_SIZE;
  for (let n = 1; n <= (options.pages ?? 6); n++) {
    const page = doc.addPage([width, height]);
    page.drawText(`READING PAGE ${n} top line`, { x: 30, y: height - 40, size: 14, font });
    page.drawText(`READING PAGE ${n} middle line`, { x: 30, y: height / 2, size: 14, font });
    if (options.cropBox) page.setCropBox(...options.cropBox);
    if (options.rotation) page.setRotation(degrees(options.rotation));
  }
  return doc.save();
}

/** A PDF that claims to be encrypted, so the app falls back to the JSON export. */
export async function buildEncryptedFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([360, 200]);
  const dictionary = doc.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    O: PDFString.of('0'.repeat(32)),
    U: PDFString.of('0'.repeat(32)),
    P: -4,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(dictionary);
  return doc.save();
}

/** A reading position as the app stores it. */
export interface StoredPosition {
  page: number;
  x: number;
  y: number;
  zoom: number;
  updatedAt: string;
}

/** The same PDF with `position` embedded in the catalog, as the app writes it on save. */
export async function withEmbeddedPosition(
  bytes: Uint8Array,
  position: StoredPosition,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.catalog.set(
    PDFName.of('PdfAnnotationsPosition'),
    PDFHexString.fromText(JSON.stringify(position)),
  );
  return doc.save();
}

/** What a saved PDF holds about the reading position. */
export interface PositionInPdf {
  /** The `PdfAnnotationsPosition` JSON, or null when absent. */
  stored: StoredPosition | null;
  /** The `/OpenAction` entries after the page ref, as numbers/`null`, or null when absent. */
  openAction: { type: string; values: (number | null)[]; pageIndex: number } | null;
}

/** Reads the position the app wrote into a saved PDF. */
export async function positionIn(bytes: Uint8Array): Promise<PositionInPdf> {
  const doc = await PDFDocument.load(bytes);
  const raw = doc.catalog.lookup(PDFName.of('PdfAnnotationsPosition'));
  const stored =
    raw instanceof PDFHexString || raw instanceof PDFString
      ? (JSON.parse(raw.decodeText()) as StoredPosition)
      : null;
  const action = doc.catalog.lookup(PDFName.of('OpenAction'));
  if (!(action instanceof PDFArray)) return { stored, openAction: null };
  const [ref, type, ...rest] = action.asArray();
  const pageIndex = doc.getPages().findIndex((page) => page.ref === ref);
  return {
    stored,
    openAction: {
      type: type instanceof PDFName ? type.decodeText() : '',
      values: rest.map((item) =>
        item instanceof PDFNumber ? item.asNumber() : item === PDFNull ? null : NaN,
      ),
      pageIndex,
    },
  };
}

/** The annotations the app stored in a saved PDF's catalog; an empty list when there are none. */
export async function annotationsIn(
  bytes: Uint8Array,
): Promise<{ id: string; comment: string; color: string; page: number }[]> {
  const doc = await PDFDocument.load(bytes);
  const stream = doc.catalog.lookup(PDFName.of('PdfAnnotationsData'));
  if (!(stream instanceof PDFRawStream)) return [];
  const json = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  return (
    JSON.parse(json) as {
      annotations: { id: string; comment: string; color: string; page: number }[];
    }
  ).annotations;
}

/** Number of indirect objects in a PDF; a stable count across cycles means nothing leaks. */
export async function objectCountOf(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects().length;
}

/** An annotation JSON file with one highlight on `page`, to mark a document dirty without selecting text. */
export function annotationJson(id: string, comment: string, quote = 'quote', page = 1): string {
  const now = '2026-01-01T00:00:00.000Z';
  return JSON.stringify({
    version: 1,
    annotations: [
      {
        id,
        page,
        rects: [[30, 100, 200, 120]],
        quote,
        comment,
        color: '#ffd54f',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}
