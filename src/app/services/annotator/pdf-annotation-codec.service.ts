import { Injectable } from '@angular/core';
import type { PDFPage } from 'pdf-lib';
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import type { Annotation, DecodedPdf, ReadingPosition } from '../../models/annotator.model';
import {
  parseAnnotationFile,
  serializeAnnotations,
} from '../../annotator/annotation-file/annotation-file';
import { removeUnreachable } from '../../annotator/unreachable-objects/unreachable-objects';
import {
  normalizeRotation,
  openActionAxis,
  parseReadingPosition,
} from '../../annotator/reading-position/reading-position';

/** Catalog key holding the JSON with every annotation (the source of truth). */
const DATA_KEY = PDFName.of('PdfAnnotationsData');
/** Marks the Highlight annotations written by this app, so they can be replaced on save. */
const ID_KEY = PDFName.of('PdfAnnotationsId');
/** Catalog key holding the reading position as a JSON text string; overwritten in place on save. */
const POSITION_KEY = PDFName.of('PdfAnnotationsPosition');
/** Standard catalog entry that makes other readers open at the reading position. */
const OPEN_ACTION_KEY = PDFName.of('OpenAction');

/**
 * Reads and writes annotations inside the PDF itself. They are stored twice:
 * as JSON in the document catalog (to restore them exactly), and as standard
 * Highlight annotations with the Markdown in /Contents, so any other PDF reader shows them.
 */
@Injectable({ providedIn: 'root' })
export class PdfAnnotationCodecService {
  /** Reads the annotations and returns the PDF without them; encrypted PDFs come back untouched. */
  async decode(bytes: Uint8Array): Promise<DecodedPdf> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pageCount = doc.getPageCount();
    if (doc.isEncrypted) {
      return { cleanBytes: bytes, annotations: [], encrypted: true, pageCount, position: null };
    }
    const annotations = this.readData(doc);
    const position = this.readPosition(doc, pageCount);
    const stripped = this.strip(doc);
    if (stripped) removeUnreachable(doc.context);
    const cleanBytes = stripped ? await doc.save() : bytes;
    return { cleanBytes, annotations, encrypted: false, pageCount, position };
  }

  /**
   * Writes the annotations into a clean PDF; annotations on missing pages are skipped. With a
   * position, it is also stored in the catalog and set as the standard /OpenAction; with null the
   * original /OpenAction and stored position are left untouched.
   */
  async encode(
    cleanBytes: Uint8Array,
    annotations: Annotation[],
    position: ReadingPosition | null,
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(cleanBytes, { updateMetadata: false });
    this.addHighlights(doc, annotations);
    this.writePosition(doc, position);
    const data = new TextEncoder().encode(serializeAnnotations(annotations));
    doc.catalog.set(DATA_KEY, doc.context.register(doc.context.flateStream(data)));
    return doc.save();
  }

  private addHighlights(doc: PDFDocument, annotations: Annotation[]): void {
    const pages = doc.getPages();
    for (const annotation of annotations) {
      const page = annotation.page > 0 ? pages.at(annotation.page - 1) : undefined;
      if (page) {
        // Only annotations are added, never content; with the default, every save would wrap the
        // page contents in yet another q/Q pair of streams
        (page.node as unknown as { autoNormalizeCTM: boolean }).autoNormalizeCTM = false;
        page.node.addAnnot(doc.context.register(this.highlightDict(doc, annotation, page.ref)));
      }
    }
  }

  /**
   * Stores the position as JSON and aims /OpenAction at it. Only the coordinate that scrolls the
   * page vertically on screen is set: y for upright pages, x for pages turned sideways.
   */
  private writePosition(doc: PDFDocument, position: ReadingPosition | null): void {
    const page: PDFPage | undefined = position ? doc.getPages().at(position.page - 1) : undefined;
    if (!position || !page) return;
    doc.catalog.set(POSITION_KEY, PDFHexString.fromText(JSON.stringify(position)));
    const axis = openActionAxis(normalizeRotation(page.getRotation().angle));
    const target = axis === 'y' ? [null, position.y, null] : [position.x, null, null];
    doc.catalog.set(OPEN_ACTION_KEY, doc.context.obj([page.ref, 'XYZ', ...target]));
  }

  private readPosition(doc: PDFDocument, pageCount: number): ReadingPosition | null {
    const value = doc.catalog.lookup(POSITION_KEY);
    if (!(value instanceof PDFHexString || value instanceof PDFString)) return null;
    try {
      const position = parseReadingPosition(JSON.parse(value.decodeText()));
      return position && position.page <= pageCount ? position : null;
    } catch {
      return null;
    }
  }

  private readData(doc: PDFDocument): Annotation[] {
    const stream = doc.catalog.lookup(DATA_KEY);
    if (!(stream instanceof PDFRawStream)) {
      return [];
    }
    return parseAnnotationFile(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
  }

  /** Removes everything this app wrote. Returns whether anything was removed. */
  private strip(doc: PDFDocument): boolean {
    let removed = this.deleteEntry(doc, doc.catalog, DATA_KEY);
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const dict = annots.lookupMaybe(i, PDFDict);
        if (dict?.has(ID_KEY)) {
          const ref = annots.get(i);
          annots.remove(i);
          if (ref instanceof PDFRef) doc.context.delete(ref);
          removed = true;
        }
      }
    }
    return removed;
  }

  private deleteEntry(doc: PDFDocument, dict: PDFDict, key: PDFName): boolean {
    const value = dict.get(key);
    if (!value) return false;
    if (value instanceof PDFRef) doc.context.delete(value);
    dict.delete(key);
    return true;
  }

  private highlightDict(doc: PDFDocument, annotation: Annotation, pageRef: PDFRef): PDFDict {
    const xs = annotation.rects.flatMap(([x1, , x2]) => [x1, x2]);
    const ys = annotation.rects.flatMap(([, y1, , y2]) => [y1, y2]);
    const dict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      // Per rect: upper-left, upper-right, lower-left, lower-right.
      QuadPoints: annotation.rects.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]),
      C: hexToRgb(annotation.color),
      CA: 0.4,
      F: 4,
      P: pageRef,
      T: PDFHexString.fromText('PDF Annotations'),
      NM: PDFHexString.fromText(annotation.id),
      Contents: PDFHexString.fromText(annotation.comment),
      M: PDFString.fromDate(new Date(annotation.updatedAt)),
    });
    dict.set(ID_KEY, PDFHexString.fromText(annotation.id));
    return dict;
  }
}

/** Converts a #rrggbb colour to the 0-1 channel values PDF expects. */
function hexToRgb(hex: string): number[] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255);
}
