import { PDFDocument, PDFName } from 'pdf-lib';
import { removeUnreachable } from './unreachable-objects';

function tags(doc: PDFDocument): string[] {
  return doc.context
    .enumerateIndirectObjects()
    .map(([ref]) => ref.tag)
    .sort();
}

describe('removeUnreachable', () => {
  it('deletes objects nothing refers to, including chains only they refer to', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const tail = doc.context.register(doc.context.obj({ Tail: true }));
    doc.context.register(doc.context.obj({ Head: tail }));
    const before = tags(doc).length;

    const removed = removeUnreachable(doc.context);

    expect(removed).toBe(2);
    expect(tags(doc).length).toBe(before - 2);
  });

  it('keeps everything reachable from the catalog, pages, arrays and stream dictionaries', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const viaArray = doc.context.register(doc.context.obj({ A: 1 }));
    const streamTarget = doc.context.register(doc.context.obj({ B: 2 }));
    const stream = doc.context.flateStream(new Uint8Array([1, 2, 3]), { Extra: streamTarget });
    doc.catalog.set(PDFName.of('Arr'), doc.context.obj([viaArray]));
    doc.catalog.set(PDFName.of('Str'), doc.context.register(stream));
    doc.context.register(doc.context.obj({ Orphan: true }));
    const all = tags(doc);

    removeUnreachable(doc.context);

    const after = tags(doc);
    expect(after).toContain(viaArray.tag);
    expect(after).toContain(streamTarget.tag);
    expect(all.filter((tag) => !after.includes(tag)).length).toBe(1);
  });

  it('keeps the Info dictionary referenced from the trailer', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const info = doc.context.register(doc.context.obj({ Title: 'x' }));
    doc.context.trailerInfo.Info = info;

    removeUnreachable(doc.context);

    expect(tags(doc)).toContain(info.tag);
  });

  it('is a no-op on a clean document', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();

    expect(removeUnreachable(doc.context)).toBe(0);
  });
});
