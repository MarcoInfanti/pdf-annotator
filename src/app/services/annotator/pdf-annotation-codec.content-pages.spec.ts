import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PDFArray, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import type { Annotation } from '../../models/annotator.model';
import { PdfAnnotationCodecService } from './pdf-annotation-codec.service';

const ANNOTATION: Annotation = {
  id: 'a',
  page: 1,
  rects: [[10, 20, 100, 40]],
  quote: 'quoted',
  comment: 'note',
  color: '#ffd54f',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

/** Pages that carry drawn text, like any real document (blank pages have no content stream). */
async function pdfWithText(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['one', 'two']) {
    doc.addPage([200, 200]).drawText(label, { x: 20, y: 100, size: 12, font });
  }
  return doc.save();
}

/** Length of the /Contents array of every page (a lone stream counts as one). */
async function contentLengths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.lookup(PDFName.of('Contents'));
    return contents instanceof PDFArray ? contents.size() : 1;
  });
}

async function objectCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).context.enumerateIndirectObjects().length;
}

describe('PdfAnnotationCodecService on pages that have content', () => {
  let codec: PdfAnnotationCodecService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    codec = TestBed.inject(PdfAnnotationCodecService);
  });

  it('keeps the object count and every /Contents array stable over repeated reopen + save cycles', async () => {
    let bytes = await codec.encode(await pdfWithText(), [ANNOTATION], null);
    const counts: number[] = [];
    const contents: number[][] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      const decoded = await codec.decode(bytes);
      bytes = await codec.encode(decoded.cleanBytes, decoded.annotations, null);
      counts.push(await objectCount(bytes));
      contents.push(await contentLengths(bytes));
    }

    expect(counts.slice(1)).toEqual(Array<number>(3).fill(counts[0]));
    expect(contents.slice(1)).toEqual(Array<number[]>(3).fill(contents[0]));
  });

  it('keeps the text of the pages and the annotation through those cycles', async () => {
    let bytes = await codec.encode(await pdfWithText(), [ANNOTATION], null);
    for (let cycle = 0; cycle < 3; cycle++) {
      const decoded = await codec.decode(bytes);
      bytes = await codec.encode(decoded.cleanBytes, decoded.annotations, null);
    }

    const decoded = await codec.decode(bytes);

    expect(decoded.annotations).toEqual([ANNOTATION]);
    expect(decoded.pageCount).toBe(2);
  });
});
