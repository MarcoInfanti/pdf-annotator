import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HIGHLIGHT_COLORS } from '../../annotator/annotator.data';
import { serializeAnnotations } from '../../annotator/annotation-file/annotation-file';
import type {
  Annotation,
  DecodedPdf,
  PickedFile,
  TextSelection,
} from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { AnnotatorSignals } from './annotator.signals';

const BYTES = new Uint8Array([1, 2, 3]);
const ENCODED = new Uint8Array([9, 9]);

function annotation(id: string, page = 1, top = 10): Annotation {
  return {
    id,
    page,
    rects: [[0, 0, 10, top]],
    quote: 'quote',
    comment: '',
    color: '#ffd54f',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function selection(page = 1, top = 10): TextSelection {
  return { page, rects: [[0, 0, 10, top]], quote: 'q', clientX: 0, clientY: 0 };
}

describe('AnnotatorSignals', () => {
  let store: AnnotatorSignals;
  let files: {
    [K in 'pickPdf' | 'pickText' | 'overwrite' | 'download']: jasmine.Spy<FileAccessService[K]>;
  };
  let codec: {
    [K in 'decode' | 'encode']: jasmine.Spy<PdfAnnotationCodecService[K]>;
  };
  let handle: FileSystemFileHandle;

  /** Opens a document through the store, with the fakes resolving the given result. */
  async function openDocument(
    options: { encrypted?: boolean; withHandle?: boolean; annotations?: Annotation[] } = {},
  ): Promise<void> {
    const picked: PickedFile = {
      name: 'book.pdf',
      bytes: BYTES,
      handle: options.withHandle ? handle : null,
    };
    const decoded: DecodedPdf = {
      cleanBytes: BYTES,
      annotations: options.annotations ?? [],
      encrypted: options.encrypted ?? false,
    };
    files.pickPdf.and.resolveTo(picked);
    codec.decode.and.resolveTo(decoded);
    await store.open();
  }

  beforeEach(() => {
    files = {
      pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf'),
      pickText: jasmine.createSpy<FileAccessService['pickText']>('pickText'),
      overwrite: jasmine.createSpy<FileAccessService['overwrite']>('overwrite'),
      download: jasmine.createSpy<FileAccessService['download']>('download'),
    };
    codec = {
      decode: jasmine.createSpy<PdfAnnotationCodecService['decode']>('decode'),
      encode: jasmine.createSpy<PdfAnnotationCodecService['encode']>('encode'),
    };
    codec.encode.and.resolveTo(ENCODED);
    handle = {} as FileSystemFileHandle;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AnnotatorSignals,
        { provide: FileAccessService, useValue: files },
        { provide: PdfAnnotationCodecService, useValue: codec },
      ],
    });
    store = TestBed.inject(AnnotatorSignals);
  });

  describe('open', () => {
    it('changes nothing when the picker is cancelled', async () => {
      files.pickPdf.and.resolveTo(null);

      await store.open();

      expect(store.document()).toBeNull();
      expect(codec.decode).not.toHaveBeenCalled();
    });

    it('sets the document and annotations and clears selection, editing and dirty', async () => {
      await openDocument({ annotations: [annotation('a')] });
      store.add(selection());
      await openDocument({ annotations: [annotation('b')] });

      expect(store.document()?.name).toBe('book.pdf');
      expect(store.annotations().map((a) => a.id)).toEqual(['b']);
      expect(store.selectedId()).toBeNull();
      expect(store.editingId()).toBeNull();
      expect(store.dirty()).toBeFalse();
    });

    it('sets a notice for an encrypted PDF', async () => {
      await openDocument({ encrypted: true });

      expect(store.notice()).toEqual({ key: 'NOTICE.ENCRYPTED' });
    });

    it('never calls confirm, even when dirty: the component asks first', async () => {
      await openDocument();
      store.add(selection());
      const confirmSpy = spyOn(window, 'confirm');

      await openDocument();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(files.pickPdf).toHaveBeenCalledTimes(2);
    });
  });

  describe('save', () => {
    it('overwrites in place when there is a handle', async () => {
      await openDocument({ withHandle: true });
      store.add(selection());

      await store.save();

      expect(files.overwrite).toHaveBeenCalledWith(handle, ENCODED);
      expect(store.notice()).toEqual({ key: 'NOTICE.SAVED_IN', params: { name: 'book.pdf' } });
      expect(store.dirty()).toBeFalse();
    });

    it('downloads the PDF when there is no handle', async () => {
      await openDocument();
      store.add(selection());

      await store.save();

      expect(files.download).toHaveBeenCalledWith(ENCODED, 'book.pdf', 'application/pdf');
      expect(store.notice()).toEqual({ key: 'NOTICE.DOWNLOADED' });
      expect(store.dirty()).toBeFalse();
    });

    it('exports JSON instead when the PDF is encrypted', async () => {
      await openDocument({ encrypted: true });

      await store.save();

      expect(codec.encode).not.toHaveBeenCalled();
      expect(files.download).toHaveBeenCalledWith(
        serializeAnnotations([]),
        'book.annotations.json',
        'application/json',
      );
    });

    it('does nothing without a document', async () => {
      await store.save();

      expect(files.download).not.toHaveBeenCalled();
    });
  });

  describe('saveCopy', () => {
    it('downloads <name>-anotado.pdf and leaves dirty unchanged', async () => {
      await openDocument();
      store.add(selection());

      await store.saveCopy();

      expect(files.download).toHaveBeenCalledWith(ENCODED, 'book-anotado.pdf', 'application/pdf');
      expect(store.dirty()).toBeTrue();
    });

    it('is a no-op for an encrypted PDF', async () => {
      await openDocument({ encrypted: true });

      await store.saveCopy();

      expect(files.download).not.toHaveBeenCalled();
    });
  });

  describe('exportJson', () => {
    it('downloads <name>.annotations.json and keeps dirty for a normal PDF', async () => {
      await openDocument();
      store.add(selection());

      store.exportJson();

      expect(files.download).toHaveBeenCalledWith(
        jasmine.any(String),
        'book.annotations.json',
        'application/json',
      );
      expect(store.dirty()).toBeTrue();
    });

    it('clears dirty when the PDF is encrypted', async () => {
      await openDocument({ encrypted: true });
      store.add(selection());

      store.exportJson();

      expect(store.dirty()).toBeFalse();
    });
  });

  describe('importJson', () => {
    it('merges new annotations, skips duplicate ids and marks dirty', async () => {
      await openDocument({ annotations: [annotation('a')] });
      files.pickText.and.resolveTo(serializeAnnotations([annotation('a'), annotation('b')]));

      await store.importJson();

      expect(
        store
          .annotations()
          .map((a) => a.id)
          .sort(),
      ).toEqual(['a', 'b']);
      expect(store.dirty()).toBeTrue();
    });

    it('is a no-op when the picker is cancelled', async () => {
      await openDocument({ annotations: [annotation('a')] });
      files.pickText.and.resolveTo(null);

      await store.importJson();

      expect(store.annotations().length).toBe(1);
      expect(store.dirty()).toBeFalse();
    });
  });

  describe('annotations', () => {
    it('add selects and edits the new annotation, marks dirty and uses the default colour', () => {
      store.add(selection());

      const [added] = store.annotations();
      expect(store.selectedId()).toBe(added.id);
      expect(store.editingId()).toBe(added.id);
      expect(store.dirty()).toBeTrue();
      expect(added.color).toBe(HIGHLIGHT_COLORS[0].value);
    });

    it('updateComment stores the comment and stops editing', () => {
      store.add(selection());
      const [added] = store.annotations();

      store.updateComment(added.id, 'hello');

      expect(store.annotations()[0].comment).toBe('hello');
      expect(store.editingId()).toBeNull();
    });

    it('remove clears selection and editing only for that id', () => {
      store.add(selection());
      store.add(selection(2));
      const [first] = store.annotations();

      store.remove(first.id);

      expect(store.annotations().length).toBe(1);
      expect(store.selectedId()).not.toBeNull();
      expect(store.editingId()).not.toBeNull();
    });

    it('remove of the selected annotation clears selection and editing', () => {
      store.add(selection());
      const [added] = store.annotations();

      store.remove(added.id);

      expect(store.selectedId()).toBeNull();
      expect(store.editingId()).toBeNull();
    });

    it('sorts by page, then top descending', () => {
      store.add(selection(2, 10));
      store.add(selection(1, 10));
      store.add(selection(1, 50));

      expect(store.annotations().map((a) => [a.page, a.rects[0][3]])).toEqual([
        [1, 50],
        [1, 10],
        [2, 10],
      ]);
    });
  });

  describe('zoom', () => {
    it('defaults the scale to 1.25', () => {
      expect(store.scale()).toBe(1.25);
    });

    it('moves to the next and previous step', () => {
      store.zoom(1);
      expect(store.scale()).toBe(1.5);

      store.setZoom(1.25);
      store.zoom(-1);
      expect(store.scale()).toBe(1.1);
    });

    it('moves to the neighbouring step from an off-step scale', () => {
      store.setZoom(1.3);
      store.zoom(1);
      expect(store.scale()).toBe(1.5);

      store.setZoom(1.3);
      store.zoom(-1);
      expect(store.scale()).toBe(1.25);
    });

    it('stays put at the ends of the range', () => {
      store.setZoom(4);
      store.zoom(1);
      expect(store.scale()).toBe(4);

      store.setZoom(0.25);
      store.zoom(-1);
      expect(store.scale()).toBe(0.25);
    });

    it('clamps setZoom to the range and keeps in-range values', () => {
      store.setZoom(10);
      expect(store.scale()).toBe(4);

      store.setZoom(0.1);
      expect(store.scale()).toBe(0.25);

      store.setZoom(1.3);
      expect(store.scale()).toBe(1.3);
    });

    it('exposes the rounded percentage', () => {
      store.setZoom(1.3);

      expect(store.zoomPercent()).toBe(130);
    });
  });

  describe('listing and search', () => {
    function commented(id: string, comment: string, quote = 'quote'): Annotation {
      return { ...annotation(id), comment, quote };
    }

    it('hides comment-less annotations unless selected or being edited', async () => {
      await openDocument({
        annotations: [commented('a', 'hello'), commented('b', ''), commented('c', '')],
      });
      expect(store.listedAnnotations().map((a) => a.id)).toEqual(['a']);

      store.select('b');
      expect(store.listedAnnotations().map((a) => a.id)).toEqual(['a', 'b']);

      store.startEditing('c');
      expect(store.listedAnnotations().map((a) => a.id)).toEqual(['a', 'c']);
    });

    it('filters quote and comment case-insensitively with a trimmed term', async () => {
      await openDocument({
        annotations: [
          commented('a', 'About FOO', 'x'),
          commented('b', 'other', 'a foo here'),
          commented('c', 'nothing', 'nope'),
        ],
      });

      store.setSearch('  FoO ');

      expect(store.search()).toBe('  FoO ');
      expect(store.visibleAnnotations().map((a) => a.id)).toEqual(['a', 'b']);
    });

    it('lists everything listed when the term is empty', async () => {
      await openDocument({ annotations: [commented('a', 'hello'), commented('b', '')] });

      expect(store.visibleAnnotations()).toEqual(store.listedAnnotations());
    });

    it('counts the annotations that have a comment', async () => {
      await openDocument({
        annotations: [commented('a', 'hello'), commented('b', ''), commented('c', 'x')],
      });

      expect(store.commentCount()).toBe(2);
    });
  });

  describe('run', () => {
    it('turns a failure into an Error notice and releases busy', async () => {
      spyOn(console, 'error');
      files.pickPdf.and.rejectWith(new Error('boom'));

      await store.open();

      expect(store.notice()).toEqual({ key: 'NOTICE.ERROR', params: { message: 'boom' } });
      expect(store.busy()).toBeFalse();
    });

    it('keeps the key of a translatable error as the notice', async () => {
      spyOn(console, 'error');
      files.pickText.and.resolveTo('{"version":2}');
      await openDocument();

      await store.importJson();

      expect(store.notice()).toEqual({ key: 'ERRORS.UNRECOGNIZED_FORMAT' });
    });

    it('describes a non-Error failure by its text', async () => {
      spyOn(console, 'error');
      files.pickPdf.and.rejectWith('plain text');

      await store.open();

      expect(store.notice()).toEqual({ key: 'NOTICE.ERROR', params: { message: 'plain text' } });
    });
  });
});
