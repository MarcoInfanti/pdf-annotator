import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HIGHLIGHT_COLORS } from '../../annotator/annotator.data';
import { serializeAnnotations } from '../../annotator/annotation-file/annotation-file';
import type {
  Annotation,
  DecodedPdf,
  PickedFile,
  ReadingPosition,
  RecoveryCopy,
  TextSelection,
} from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { SessionStorageService } from '../../services/annotator/session-storage.service';
import { AnnotatorSignals } from './annotator.signals';

const BYTES = new Uint8Array([1, 2, 3]);
const ENCODED = new Uint8Array([9, 9]);
const POSITION_KEY = 'pdf-annotations.position.book.pdf|3';
const RECOVERY_KEY = 'pdf-annotations.recovery.book.pdf|3';
const STAMP = { size: 3, lastModified: 1000 };

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
    [K in 'pickPdf' | 'refresh' | 'pickText' | 'overwrite' | 'download']: jasmine.Spy<
      FileAccessService[K]
    >;
  };
  let codec: {
    [K in 'decode' | 'encode']: jasmine.Spy<PdfAnnotationCodecService[K]>;
  };
  let handle: FileSystemFileHandle;

  /** Opens a document through the store, with the fakes resolving the given result. */
  async function openDocument(
    options: {
      encrypted?: boolean;
      withHandle?: boolean;
      annotations?: Annotation[];
      position?: ReadingPosition | null;
    } = {},
  ): Promise<void> {
    const picked: PickedFile = {
      name: 'book.pdf',
      bytes: BYTES,
      handle: options.withHandle ? handle : null,
      stamp: STAMP,
      writeGranted: options.withHandle ?? false,
    };
    const decoded: DecodedPdf = {
      cleanBytes: BYTES,
      annotations: options.annotations ?? [],
      encrypted: options.encrypted ?? false,
      pageCount: 3,
      position: options.position ?? null,
    };
    files.pickPdf.and.resolveTo(picked);
    codec.decode.and.resolveTo(decoded);
    await store.open();
  }

  beforeEach(() => {
    files = {
      pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf'),
      refresh: jasmine.createSpy<FileAccessService['refresh']>('refresh'),
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

  afterEach(() => {
    localStorage.removeItem(POSITION_KEY);
    localStorage.removeItem(RECOVERY_KEY);
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

  describe('revision and markSaved', () => {
    it('bumps the revision and sets dirty on every real change', async () => {
      await openDocument({ annotations: [annotation('a')] });
      const changes: (() => void)[] = [
        () => store.add(selection()),
        () => store.updateComment('a', 'hello'),
        () => store.changeColor('a', '#00ff00'),
        () => store.remove('a'),
      ];

      for (const change of changes) {
        const before = store.revision();
        change();
        expect(store.revision()).toBe(before + 1);
        expect(store.dirty()).toBeTrue();
        store.markSaved(store.revision());
        expect(store.dirty()).toBeFalse();
      }
    });

    it('bumps the revision when importing JSON', async () => {
      await openDocument();
      files.pickText.and.resolveTo(serializeAnnotations([annotation('b')]));
      const before = store.revision();

      await store.importJson();

      expect(store.revision()).toBe(before + 1);
    });

    it('does not touch the revision or dirty for select, zoom, search or editing', async () => {
      await openDocument({ annotations: [annotation('a')] });
      const before = store.revision();

      store.select('a');
      store.startEditing('a');
      store.stopEditing();
      store.zoom(1);
      store.setZoom(2);
      store.setSearch('x');

      expect(store.revision()).toBe(before);
      expect(store.dirty()).toBeFalse();
    });

    it('markSaved clears dirty for the current revision and keeps it for an older one', () => {
      store.add(selection());
      const stale = store.revision();
      store.add(selection());

      store.markSaved(stale);
      expect(store.dirty()).toBeTrue();

      store.markSaved(store.revision());
      expect(store.dirty()).toBeFalse();
    });
  });

  describe('reportNotice', () => {
    it('shows the notice', () => {
      store.reportNotice({ key: 'NOTICE.SAVED_IN', params: { name: 'x.pdf' } });

      expect(store.notice()).toEqual({ key: 'NOTICE.SAVED_IN', params: { name: 'x.pdf' } });
    });
  });

  describe('pick and load', () => {
    const picked: PickedFile = {
      name: 'book.pdf',
      bytes: BYTES,
      handle: null,
      stamp: STAMP,
      writeGranted: false,
    };

    it('pick leaves the session alone and returns the file', async () => {
      await openDocument({ annotations: [annotation('a')] });
      store.add(selection());
      files.pickPdf.and.resolveTo(picked);

      expect(await store.pick()).toBe(picked);

      expect(store.annotations().length).toBe(2);
      expect(store.dirty()).toBeTrue();
      expect(codec.decode).toHaveBeenCalledTimes(1);
    });

    it('pick returns null when cancelled', async () => {
      files.pickPdf.and.resolveTo(null);

      expect(await store.pick()).toBeNull();
    });

    it('pick turns a failure into a notice and null', async () => {
      spyOn(console, 'error');
      files.pickPdf.and.rejectWith(new Error('boom'));

      expect(await store.pick()).toBeNull();

      expect(store.notice()).toEqual({ key: 'NOTICE.ERROR', params: { message: 'boom' } });
      expect(store.busy()).toBeFalse();
    });

    it('load resets the session the way open does', async () => {
      await openDocument({ annotations: [annotation('a')] });
      store.add(selection());
      codec.decode.and.resolveTo({
        cleanBytes: BYTES,
        annotations: [annotation('b')],
        encrypted: false,
        pageCount: 5,
        position: null,
      });

      await store.load(picked);

      expect(store.document()).toEqual(
        jasmine.objectContaining({ name: 'book.pdf', pageCount: 5, stamp: STAMP }),
      );
      expect(store.annotations().map((a) => a.id)).toEqual(['b']);
      expect(store.selectedId()).toBeNull();
      expect(store.editingId()).toBeNull();
      expect(store.dirty()).toBeFalse();
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

    it('is a no-op when every imported id is already present', async () => {
      await openDocument({ annotations: [annotation('a')] });
      files.pickText.and.resolveTo(serializeAnnotations([annotation('a')]));
      const before = store.revision();

      await store.importJson();

      expect(store.revision()).toBe(before);
      expect(store.dirty()).toBeFalse();
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

  describe('reading position', () => {
    const START = { page: 1, x: 0, y: 800 };
    const OLDER: ReadingPosition = {
      page: 2,
      x: 5,
      y: 600,
      zoom: 1,
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const NEWER: ReadingPosition = {
      page: 3,
      x: 7,
      y: 300,
      zoom: 1,
      updatedAt: '2024-02-01T00:00:00.000Z',
    };

    function storePosition(position: ReadingPosition): void {
      localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    }

    it('setPosition remembers the spot with the current zoom and leaves the document clean', async () => {
      await openDocument();
      store.setZoom(2);

      store.setPosition({ page: 2, x: 11, y: 22 });

      const stored = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null') as ReadingPosition;
      expect(stored).toEqual(jasmine.objectContaining({ page: 2, x: 11, y: 22, zoom: 2 }));
      expect(store.position()).toEqual(stored);
      expect(store.dirty()).toBeFalse();
      expect(store.revision()).toBe(0);
    });

    it('setPosition does nothing without a document', () => {
      store.setPosition({ page: 2, x: 1, y: 2 });

      expect(store.position()).toBeNull();
      expect(localStorage.getItem(POSITION_KEY)).toBeNull();
    });

    it('has no position until one is captured, even when one is stored', async () => {
      storePosition(OLDER);

      await openDocument();

      expect(store.position()).toBeNull();
    });

    it('forgets the previous document position when another one opens', async () => {
      await openDocument();
      store.setPosition({ page: 2, x: 1, y: 2 });

      await openDocument();

      expect(store.position()).toBeNull();
    });

    it('offers the position stored in the browser', async () => {
      storePosition(OLDER);

      await openDocument();
      store.setDocumentStart(START);

      expect(store.resumeOffer()).toEqual(OLDER);
    });

    it('offers the position embedded in the PDF', async () => {
      await openDocument({ position: NEWER });
      store.setDocumentStart(START);

      expect(store.resumeOffer()).toEqual(NEWER);
    });

    it('offers the newer of the two, and the PDF one on a tie', async () => {
      storePosition(OLDER);
      await openDocument({ position: NEWER });
      store.setDocumentStart(START);
      expect(store.resumeOffer()).toEqual(NEWER);

      storePosition(NEWER);
      await openDocument({ position: OLDER });
      store.setDocumentStart(START);
      expect(store.resumeOffer()).toEqual(NEWER);

      const tied = { ...NEWER, x: 99 };
      storePosition(NEWER);
      await openDocument({ position: tied });
      store.setDocumentStart(START);
      expect(store.resumeOffer()).toEqual(tied);
    });

    it('offers nothing before the start of the document is known', async () => {
      storePosition(OLDER);

      await openDocument();

      expect(store.resumeOffer()).toBeNull();
    });

    it('offers nothing when the position is the start of the document', async () => {
      storePosition({ ...OLDER, page: 1, x: 0.5, y: 799.5 });

      await openDocument();
      store.setDocumentStart(START);

      expect(store.resumeOffer()).toBeNull();
    });

    it('closes the offer when dismissed and does not bring it back after a save', async () => {
      storePosition(OLDER);
      await openDocument();
      store.setDocumentStart(START);

      store.dismissResume();
      store.add(selection());
      store.markSaved(store.revision());

      expect(store.resumeOffer()).toBeNull();
    });

    it('offers a position next to the encrypted notice, which stays in its own slot', async () => {
      storePosition(OLDER);

      await openDocument({ encrypted: true });
      store.setDocumentStart(START);

      expect(store.notice()).toEqual({ key: 'NOTICE.ENCRYPTED' });
      expect(store.resumeOffer()).toEqual(OLDER);
    });

    it('saveCopy writes the captured position into the PDF, and none before a capture', async () => {
      await openDocument();
      await store.saveCopy();
      expect(codec.encode.calls.mostRecent().args[2]).toBeNull();

      store.setPosition({ page: 2, x: 1, y: 2 });
      await store.saveCopy();

      expect(codec.encode.calls.mostRecent().args[2]).toEqual(store.position());
    });
  });

  describe('recovery copy', () => {
    const IDENTITY = { name: 'book.pdf', pageCount: 3 };
    const OTHER_STAMP = { size: 3, lastModified: 2000 };
    let session: SessionStorageService;

    function copyOf(): RecoveryCopy | null {
      return session.readRecovery(IDENTITY);
    }

    beforeEach(() => {
      session = TestBed.inject(SessionStorageService);
    });

    afterEach(() => localStorage.removeItem(RECOVERY_KEY));

    it('writes nothing until it is enabled', async () => {
      await openDocument();

      store.add(selection());

      expect(copyOf()).toBeNull();
    });

    it('copies the annotations with the baseline of the opened file on every change', async () => {
      await openDocument();
      store.setRecoveryEnabled(true);

      store.add(selection());
      store.add(selection(2));

      expect(copyOf()?.baseline).toEqual(STAMP);
      expect(copyOf()?.annotations.length).toBe(2);
    });

    it('copies at once when enabled while there are unsaved changes', async () => {
      await openDocument();
      store.add(selection());

      store.setRecoveryEnabled(true);

      expect(copyOf()?.annotations.length).toBe(1);
    });

    it('does not copy a clean document when enabled', async () => {
      await openDocument();

      store.setRecoveryEnabled(true);

      expect(copyOf()).toBeNull();
    });

    it('keeps an existing copy frozen after being disabled', async () => {
      await openDocument();
      store.setRecoveryEnabled(true);
      store.add(selection());

      store.setRecoveryEnabled(false);
      store.add(selection(2));

      expect(copyOf()?.annotations.length).toBe(1);
    });

    it('uses the baseline refreshed after a write', async () => {
      await openDocument();
      store.setRecoveryEnabled(true);
      store.updateBaseline(OTHER_STAMP);

      store.add(selection());

      expect(copyOf()?.baseline).toEqual(OTHER_STAMP);
    });

    it('clears the copy when the changes are saved, but not for an older revision', async () => {
      await openDocument();
      store.setRecoveryEnabled(true);
      store.add(selection());
      const stale = store.revision();
      store.add(selection(2));

      store.markSaved(stale);
      expect(copyOf()).not.toBeNull();
      store.markSaved(store.revision());

      expect(copyOf()).toBeNull();
    });

    it('clears the copy when an encrypted PDF is exported to JSON', async () => {
      await openDocument({ encrypted: true });
      store.setRecoveryEnabled(true);
      store.add(selection());

      store.exportJson();

      expect(copyOf()).toBeNull();
    });

    it('keeps the copy when exporting JSON does not save an ordinary PDF', async () => {
      await openDocument();
      store.setRecoveryEnabled(true);
      store.add(selection());

      store.exportJson();

      expect(copyOf()).not.toBeNull();
    });

    describe('on reopen', () => {
      function seed(annotations: Annotation[], baseline = STAMP): void {
        session.writeRecovery(IDENTITY, annotations, baseline);
      }

      it('replaces the annotations exactly when the file is unchanged, and marks dirty', async () => {
        seed([annotation('x'), annotation('b')]);

        await openDocument({ annotations: [annotation('a'), annotation('b')] });
        expect(store.recoveryOffer()).not.toBeNull();
        store.recover();

        expect(store.annotations().map((a) => a.id)).toEqual(['x', 'b']);
        expect(store.dirty()).toBeTrue();
        expect(store.recoveryOffer()).toBeNull();
      });

      it('restores deletions too when the file is unchanged', async () => {
        seed([]);

        await openDocument({ annotations: [annotation('a')] });
        store.recover();

        expect(store.annotations()).toEqual([]);
        expect(store.dirty()).toBeTrue();
      });

      it('clears selection and editing when it replaces', async () => {
        seed([annotation('x')]);
        await openDocument({ annotations: [annotation('a')] });
        store.startEditing('a');

        store.recover();

        expect(store.selectedId()).toBeNull();
        expect(store.editingId()).toBeNull();
      });

      it('merges by id when the modification time differs, and marks dirty', async () => {
        seed([annotation('a'), annotation('x')], OTHER_STAMP);

        await openDocument({ annotations: [annotation('a'), annotation('b')] });
        store.recover();

        expect(store.annotations().map((a) => a.id)).toEqual(['a', 'b', 'x']);
        expect(store.dirty()).toBeTrue();
      });

      it('merges by id when only the size differs', async () => {
        seed([annotation('x')], { ...STAMP, size: 99 });

        await openDocument({ annotations: [annotation('a')] });
        store.recover();

        expect(store.annotations().map((a) => a.id)).toEqual(['a', 'x']);
      });

      it('offers nothing, and clears the copy, when a different file gains nothing from it', async () => {
        seed([annotation('a')], OTHER_STAMP);

        await openDocument({ annotations: [annotation('a'), annotation('b')] });

        expect(store.recoveryOffer()).toBeNull();
        expect(copyOf()).toBeNull();
      });

      it('offers nothing, and clears the copy, when it equals what the file holds', async () => {
        seed([annotation('a')]);

        await openDocument({ annotations: [annotation('a')] });

        expect(store.recoveryOffer()).toBeNull();
        expect(copyOf()).toBeNull();
      });

      it('keeps the copy when the offer is dismissed', async () => {
        seed([annotation('x')]);
        await openDocument();

        store.dismissRecovery();

        expect(store.recoveryOffer()).toBeNull();
        expect(copyOf()).not.toBeNull();
      });

      it('keeps the offer apart from the notice', async () => {
        seed([annotation('x')]);

        await openDocument();

        expect(store.recoveryOffer()).not.toBeNull();
        expect(store.notice()).toBeNull();
        store.dismissNotice();
        expect(store.recoveryOffer()).not.toBeNull();
      });

      it('does not offer a copy of another document', async () => {
        session.writeRecovery({ name: 'other.pdf', pageCount: 3 }, [annotation('x')], STAMP);

        await openDocument();

        expect(store.recoveryOffer()).toBeNull();
        session.clearRecovery({ name: 'other.pdf', pageCount: 3 });
      });
    });
  });

  describe('rulings after the testing pass', () => {
    it('does not count changeColor to the same colour as a change', async () => {
      await openDocument({ annotations: [annotation('a')] });
      const before = store.revision();

      store.changeColor('a', annotation('a').color);

      expect(store.revision()).toBe(before);
      expect(store.dirty()).toBeFalse();
    });

    it('does not count updateComment with the same comment, but still closes the editor', async () => {
      await openDocument({ annotations: [annotation('a')] });
      store.startEditing('a');
      const before = store.revision();

      store.updateComment('a', '');

      expect(store.revision()).toBe(before);
      expect(store.dirty()).toBeFalse();
      expect(store.editingId()).toBeNull();
    });

    it('does not count changes to an annotation that does not exist', async () => {
      await openDocument({ annotations: [annotation('a')] });
      const before = store.revision();

      store.changeColor('missing', '#000000');
      store.updateComment('missing', 'x');
      store.remove('missing');

      expect(store.revision()).toBe(before);
      expect(store.dirty()).toBeFalse();
    });

    it('still counts a real colour or comment change', async () => {
      await openDocument({ annotations: [annotation('a')] });

      store.changeColor('a', '#00ff00');
      store.updateComment('a', 'hello');

      expect(store.revision()).toBe(2);
    });

    it('hides the recovery offer on the first real change, keeping the copy', async () => {
      TestBed.inject(SessionStorageService).writeRecovery(
        { name: 'book.pdf', pageCount: 3 },
        [annotation('x')],
        STAMP,
      );
      await openDocument();
      expect(store.recoveryOffer()).not.toBeNull();

      store.add(selection());

      expect(store.recoveryOffer()).toBeNull();
      expect(
        TestBed.inject(SessionStorageService).readRecovery({ name: 'book.pdf', pageCount: 3 }),
      ).not.toBeNull();
    });

    it('hides the recovery offer on a save', async () => {
      TestBed.inject(SessionStorageService).writeRecovery(
        { name: 'book.pdf', pageCount: 3 },
        [annotation('x')],
        STAMP,
      );
      await openDocument();

      store.markSaved(store.revision());

      expect(store.recoveryOffer()).toBeNull();
    });

    it('ignores a stored position beyond the page count', async () => {
      localStorage.setItem(POSITION_KEY, JSON.stringify({ ...stored(), page: 4 }));

      await openDocument();
      store.setDocumentStart({ page: 1, x: 0, y: 800 });

      expect(store.resumeOffer()).toBeNull();
    });

    it('keeps a stored position on the last page', async () => {
      localStorage.setItem(POSITION_KEY, JSON.stringify({ ...stored(), page: 3 }));

      await openDocument();
      store.setDocumentStart({ page: 1, x: 0, y: 800 });

      expect(store.resumeOffer()?.page).toBe(3);
    });

    function stored(): ReadingPosition {
      return { page: 2, x: 5, y: 600, zoom: 1, updatedAt: '2024-01-01T00:00:00.000Z' };
    }
  });

  describe('reread', () => {
    const picked: PickedFile = {
      name: 'book.pdf',
      bytes: BYTES,
      handle: null,
      stamp: STAMP,
      writeGranted: false,
    };

    it('returns the file as read again', async () => {
      const fresh = { ...picked, bytes: new Uint8Array([7]) };
      files.refresh.and.resolveTo(fresh);

      expect(await store.reread(picked)).toBe(fresh);
      expect(files.refresh).toHaveBeenCalledOnceWith(picked);
    });

    it('turns a failure into a notice and null', async () => {
      spyOn(console, 'error');
      files.refresh.and.rejectWith(new Error('gone'));

      expect(await store.reread(picked)).toBeNull();
      expect(store.notice()).toEqual({ key: 'NOTICE.ERROR', params: { message: 'gone' } });
    });
  });
});
