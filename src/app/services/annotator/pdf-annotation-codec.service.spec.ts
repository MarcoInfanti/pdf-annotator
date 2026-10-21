import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
} from 'pdf-lib';
import type { Annotation, ReadingPosition } from '../../models/annotator.model';
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

    const decoded = await codec.decode(await codec.encode(await blankPdf(), annotations, null));

    expect(decoded.annotations).toEqual(annotations);
    expect(decoded.encrypted).toBeFalse();
  });

  it('decode returns bytes without the annotations or the catalog data this app wrote', async () => {
    const encoded = await codec.encode(await blankPdf(), [annotation('a', 1)], null);

    const { cleanBytes } = await codec.decode(encoded);

    const clean = await PDFDocument.load(cleanBytes);
    expect(annotsOf(clean, 0).filter((d) => d.has(PDFName.of('PdfAnnotationsId')))).toEqual([]);
    expect(clean.catalog.has(PDFName.of('PdfAnnotationsData'))).toBeFalse();
  });

  it('writes the catalog key and the standard annotation fields', async () => {
    const encoded = await PDFDocument.load(
      await codec.encode(await blankPdf(), [annotation('abc', 1, 'hello')], null),
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
      await codec.encode(await blankPdf(), [annotation('a', 1), annotation('x', 9)], null),
    );

    expect(annotsOf(encoded, 0).length).toBe(1);
    expect(annotsOf(encoded, 1).length).toBe(0);
  });

  describe('reading position', () => {
    const position: ReadingPosition = {
      page: 2,
      x: 12.5,
      y: 700.25,
      zoom: 1.5,
      updatedAt: '2024-03-01T10:00:00.000Z',
    };

    /** The /OpenAction array of an encoded PDF, as plain values: the page index and XYZ operands. */
    async function openActionOf(bytes: Uint8Array): Promise<(number | null)[] | null> {
      const doc = await PDFDocument.load(bytes);
      const action = doc.catalog.lookupMaybe(PDFName.of('OpenAction'), PDFArray);
      if (!action) return null;
      const operands = [2, 3, 4].map((i) => action.get(i));
      return operands.map((o) => (o instanceof PDFNumber ? o.asNumber() : null));
    }

    async function encodeRotated(rotation: number): Promise<Uint8Array> {
      const doc = await PDFDocument.create();
      doc.addPage().setRotation(degrees(rotation));
      doc.addPage().setRotation(degrees(rotation));
      return codec.encode(await doc.save(), [], position);
    }

    it('round-trips x and y exactly, and the page count', async () => {
      const decoded = await codec.decode(await codec.encode(await blankPdf(), [], position));

      expect(decoded.position).toEqual(position);
      expect(decoded.pageCount).toBe(2);
    });

    it('opens on the y of the position for upright pages', async () => {
      for (const rotation of [0, 180]) {
        expect(await openActionOf(await encodeRotated(rotation))).toEqual([null, 700.25, null]);
      }
    });

    it('opens on the x of the position for sideways pages', async () => {
      for (const rotation of [90, 270]) {
        expect(await openActionOf(await encodeRotated(rotation))).toEqual([12.5, null, null]);
      }
    });

    it('honours a /Rotate inherited from the Pages node', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      doc.addPage();
      doc.catalog.lookup(PDFName.of('Pages'), PDFDict).set(PDFName.of('Rotate'), PDFNumber.of(90));

      const encoded = await codec.encode(await doc.save(), [], position);

      expect(await openActionOf(encoded)).toEqual([12.5, null, null]);
    });

    it('points /OpenAction at the page with an XYZ destination', async () => {
      const doc = await PDFDocument.load(await codec.encode(await blankPdf(), [], position));
      const action = doc.catalog.lookup(PDFName.of('OpenAction'), PDFArray);

      expect(action.get(0)).toBe(doc.getPages()[1].ref);
      expect(action.get(1)).toBe(PDFName.of('XYZ'));
      expect(action.get(2)).toBe(PDFNull);
    });

    it('leaves the original /OpenAction and position alone when there is no position', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj([doc.getPages()[0].ref, 'Fit']));
      doc.catalog.set(PDFName.of('PdfAnnotationsPosition'), PDFHexString.fromText('keep'));

      const encoded = await PDFDocument.load(await codec.encode(await doc.save(), [], null));

      const action = encoded.catalog.lookup(PDFName.of('OpenAction'), PDFArray);
      expect(action.get(1)).toBe(PDFName.of('Fit'));
      const stored = encoded.catalog.lookup(PDFName.of('PdfAnnotationsPosition'));
      expect(stored instanceof PDFHexString && stored.decodeText()).toBe('keep');
    });

    it('does not grow over repeated reopen + save cycles', async () => {
      const annotations = [annotation('a', 1), annotation('b', 2)];
      let bytes = await codec.encode(await blankPdf(), annotations, position);
      const sizes: number[] = [];
      const counts: number[] = [];

      for (let cycle = 0; cycle < 5; cycle++) {
        bytes = await codec.encode((await codec.decode(bytes)).cleanBytes, annotations, position);
        sizes.push(bytes.length);
        counts.push((await PDFDocument.load(bytes)).context.enumerateIndirectObjects().length);
      }

      expect(sizes.slice(1)).toEqual(Array(4).fill(sizes[1]));
      expect(counts.slice(1)).toEqual(Array(4).fill(counts[1]));
    });

    it('keeps every object the stripped document still refers to', async () => {
      const encoded = await codec.encode(await blankPdf(), [annotation('a', 1)], position);

      const { cleanBytes } = await codec.decode(encoded);

      const clean = await PDFDocument.load(cleanBytes);
      expect(clean.getPageCount()).toBe(2);
      for (const page of clean.getPages()) expect(page.node.Parent()).toBeDefined();
      expect(clean.catalog.has(PDFName.of('PdfAnnotationsPosition'))).toBeTrue();
    });

    it('keeps a single position entry and a single /OpenAction after repeated cycles', async () => {
      let bytes = await codec.encode(await blankPdf(), [], position);
      for (let cycle = 0; cycle < 3; cycle++) {
        bytes = await codec.encode((await codec.decode(bytes)).cleanBytes, [], position);
      }

      const doc = await PDFDocument.load(bytes);
      const keys = doc.catalog.keys().map((key) => key.decodeText());
      expect(keys.filter((key) => key === 'OpenAction').length).toBe(1);
      expect(keys.filter((key) => key === 'PdfAnnotationsPosition').length).toBe(1);
    });

    it('writes nothing when the position points at a missing page', async () => {
      const encoded = await PDFDocument.load(
        await codec.encode(await blankPdf(), [], { ...position, page: 9 }),
      );

      expect(encoded.catalog.has(PDFName.of('OpenAction'))).toBeFalse();
      expect(encoded.catalog.has(PDFName.of('PdfAnnotationsPosition'))).toBeFalse();
    });

    it('decodes garbage or an out-of-range page as no position', async () => {
      for (const text of ['not json', '{"page":1}', JSON.stringify({ ...position, page: 5 })]) {
        const doc = await PDFDocument.load(await blankPdf());
        doc.catalog.set(PDFName.of('PdfAnnotationsPosition'), PDFHexString.fromText(text));

        expect((await codec.decode(await doc.save())).position).toBeNull();
      }
    });

    it('decodes a PDF without a position as null', async () => {
      expect((await codec.decode(await blankPdf())).position).toBeNull();
    });

    it('keeps the position entry when stripping annotations', async () => {
      const encoded = await codec.encode(await blankPdf(), [annotation('a', 1)], position);

      const { cleanBytes } = await codec.decode(encoded);

      const clean = await PDFDocument.load(cleanBytes);
      expect(clean.catalog.has(PDFName.of('PdfAnnotationsPosition'))).toBeTrue();
    });
  });
});
