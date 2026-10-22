import { Injectable } from '@angular/core';
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
import type { Annotation, DecodedPdf } from '../../models/annotator.model';
import {
  parseAnnotationFile,
  serializeAnnotations,
} from '../../annotator/annotation-file/annotation-file';

/** Catalog key holding the JSON with every annotation (the source of truth). */
const DATA_KEY = PDFName.of('PdfAnnotationsData');
/** Marks the Highlight annotations written by this app, so they can be replaced on save. */
const ID_KEY = PDFName.of('PdfAnnotationsId');

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
    if (doc.isEncrypted) {
      return { cleanBytes: bytes, annotations: [], encrypted: true };
    }
    const annotations = this.readData(doc);
    const stripped = this.strip(doc);
    const cleanBytes = stripped ? await doc.save() : bytes;
    return { cleanBytes, annotations, encrypted: false };
  }

  /** Writes the annotations into a clean PDF; annotations on missing pages are skipped. */
  async encode(cleanBytes: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
    const doc = await PDFDocument.load(cleanBytes, { updateMetadata: false });
    const pages = doc.getPages();
    for (const annotation of annotations) {
      const page = annotation.page > 0 ? pages.at(annotation.page - 1) : undefined;
      if (page) {
        page.node.addAnnot(doc.context.register(this.highlightDict(doc, annotation, page.ref)));
      }
    }
    const data = new TextEncoder().encode(serializeAnnotations(annotations));
    doc.catalog.set(DATA_KEY, doc.context.register(doc.context.flateStream(data)));
    return doc.save();
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
