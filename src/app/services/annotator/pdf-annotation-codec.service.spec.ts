import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import type { Annotation } from '../../models/annotator.model';
import { PdfAnnotationCodecService } from './pdf-annotation-codec.service';

function annotation(id: string, page: number, comment = 'a **note**'): Annotation {
  return {
    id,
    page,
    rects: [[10, 20, 100, 40]],
    quote: 'quoted',
    comment,
    color: '#ffd54f',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  return doc.save();
}

function annotsOf(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const annots = doc.getPages()[pageIndex].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annots ? annots.asArray().map((_, i) => annots.lookup(i, PDFDict)) : [];
}

function text(dict: PDFDict, key: string): string {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFHexString ? value.decodeText() : '';
}

describe('PdfAnnotationCodecService', () => {
  let codec: PdfAnnotationCodecService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    codec = TestBed.inject(PdfAnnotationCodecService);
  });

  it('round-trips annotations exactly', async () => {
    const annotations = [annotation('a', 1), annotation('b', 2, 'second')];

    const decoded = await codec.decode(await codec.encode(await blankPdf(), annotations));

    expect(decoded.annotations).toEqual(annotations);
    expect(decoded.encrypted).toBeFalse();
  });

  it('decode returns bytes without the annotations or the catalog data this app wrote', async () => {
    const encoded = await codec.encode(await blankPdf(), [annotation('a', 1)]);

    const { cleanBytes } = await codec.decode(encoded);

    const clean = await PDFDocument.load(cleanBytes);
    expect(annotsOf(clean, 0).filter((d) => d.has(PDFName.of('PdfAnnotationsId')))).toEqual([]);
    expect(clean.catalog.has(PDFName.of('PdfAnnotationsData'))).toBeFalse();
  });

  it('writes the catalog key and the standard annotation fields', async () => {
    const encoded = await PDFDocument.load(
      await codec.encode(await blankPdf(), [annotation('abc', 1, 'hello')]),
    );

    expect(encoded.catalog.has(PDFName.of('PdfAnnotationsData'))).toBeTrue();
    const [dict] = annotsOf(encoded, 0);
    expect(dict.has(PDFName.of('PdfAnnotationsId'))).toBeTrue();
    expect(text(dict, 'NM')).toBe('abc');
    expect(text(dict, 'Contents')).toBe('hello');
    expect(text(dict, 'T')).toBe('PDF Annotations');
  });

  it('decodes a PDF without app data to no annotations', async () => {
    const decoded = await codec.decode(await blankPdf());

    expect(decoded.annotations).toEqual([]);
    expect(decoded.encrypted).toBeFalse();
  });

  it('skips an annotation on a page that does not exist', async () => {
    const encoded = await PDFDocument.load(
      await codec.encode(await blankPdf(), [annotation('a', 1), annotation('x', 9)]),
    );

    expect(annotsOf(encoded, 0).length).toBe(1);
    expect(annotsOf(encoded, 1).length).toBe(0);
  });
});
