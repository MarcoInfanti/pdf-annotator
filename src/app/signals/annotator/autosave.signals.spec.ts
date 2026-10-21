import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { serializeAnnotations } from '../../annotator/annotation-file/annotation-file';
import type {
  Annotation,
  DecodedPdf,
  FileStamp,
  PickedFile,
  TextSelection,
} from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { SessionStorageService } from '../../services/annotator/session-storage.service';
import { AutosavePreferenceService } from '../../services/layout/autosave-preference.service';
import { AnnotatorSignals } from './annotator.signals';
import { AutosaveSignals } from './autosave.signals';

const BYTES = new Uint8Array([1, 2, 3]);
const ENCODED = new Uint8Array([9, 9]);
const STAMP: FileStamp = { size: 3, lastModified: 1000 };
const PREFERENCE_KEY = 'pdf-annotations.autosave';

function annotation(id: string): Annotation {
  return {
    id,
    page: 1,
    rects: [[0, 0, 10, 10]],
    quote: 'quote',
    comment: '',
    color: '#ffd54f',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function selection(page = 1): TextSelection {
  return { page, rects: [[0, 0, 10, 10]], quote: 'q', clientX: 0, clientY: 0 };
}

/** A promise settled from the outside, to hold a fake write open. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run, including chains of a few awaits. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('AutosaveSignals', () => {
  let annotator: AnnotatorSignals;
  let autosave: AutosaveSignals;
  let files: {
    [
      K in
        | 'pickPdf'
        | 'pickText'
        | 'overwrite'
        | 'download'
        | 'hasWritePermission'
        | 'requestWritePermission'
        | 'stampOf'
    ]: jasmine.Spy<FileAccessService[K]>;
  };
  let codec: { [K in 'decode' | 'encode']: jasmine.Spy<PdfAnnotationCodecService[K]> };
  let handle: FileSystemFileHandle;

  /** Opens a document through the annotator store. */
  async function openDocument(
    options: {
      encrypted?: boolean;
      withHandle?: boolean;
      writeGranted?: boolean;
      annotations?: Annotation[];
    } = {},
  ): Promise<void> {
    const withHandle = options.withHandle ?? true;
    const picked: PickedFile = {
      name: 'book.pdf',
      bytes: BYTES,
      handle: withHandle ? handle : null,
      stamp: STAMP,
      writeGranted: withHandle && (options.writeGranted ?? true),
    };
    const decoded: DecodedPdf = {
      cleanBytes: BYTES,
      annotations: options.annotations ?? [],
      encrypted: options.encrypted ?? false,
      pageCount: 3,
      position: null,
    };
    files.pickPdf.and.resolveTo(picked);
    codec.decode.and.resolveTo(decoded);
    await annotator.open();
    TestBed.tick();
  }

  beforeEach(() => {
    localStorage.removeItem(PREFERENCE_KEY);
    files = {
      pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf'),
      pickText: jasmine.createSpy<FileAccessService['pickText']>('pickText'),
      overwrite: jasmine.createSpy<FileAccessService['overwrite']>('overwrite'),
      download: jasmine.createSpy<FileAccessService['download']>('download'),
      hasWritePermission: jasmine
        .createSpy<FileAccessService['hasWritePermission']>('hasWritePermission')
        .and.resolveTo(true),
      requestWritePermission: jasmine
        .createSpy<FileAccessService['requestWritePermission']>('requestWritePermission')
        .and.resolveTo(true),
      stampOf: jasmine.createSpy<FileAccessService['stampOf']>('stampOf').and.resolveTo(STAMP),
    };
    files.overwrite.and.resolveTo();
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
        AutosaveSignals,
        { provide: FileAccessService, useValue: files },
        { provide: PdfAnnotationCodecService, useValue: codec },
      ],
    });
    annotator = TestBed.inject(AnnotatorSignals);
    autosave = TestBed.inject(AutosaveSignals);
  });

  afterEach(() => {
    localStorage.removeItem(PREFERENCE_KEY);
    localStorage.removeItem('pdf-annotations.position.book.pdf|3');
  });

  describe('save', () => {
    it('overwrites in place when there is a handle', async () => {
      await openDocument();
      annotator.add(selection());

      await autosave.save();

      expect(files.overwrite).toHaveBeenCalledOnceWith(handle, ENCODED);
      expect(annotator.notice()).toEqual({ key: 'NOTICE.SAVED_IN', params: { name: 'book.pdf' } });
      expect(annotator.dirty()).toBeFalse();
    });

    it('writes the captured reading position into the PDF, and none before a capture', async () => {
      await openDocument();
      await autosave.save();
      expect(codec.encode.calls.mostRecent().args[2]).toBeNull();

      annotator.setPosition({ page: 2, x: 1, y: 2 });
      await autosave.save();

      expect(codec.encode.calls.mostRecent().args[2]).toEqual(annotator.position());
    });

    it('downloads the PDF when there is no handle', async () => {
      await openDocument({ withHandle: false });
      annotator.add(selection());

      await autosave.save();

      expect(files.download).toHaveBeenCalledWith(ENCODED, 'book.pdf', 'application/pdf');
      expect(annotator.notice()).toEqual({ key: 'NOTICE.DOWNLOADED' });
      expect(annotator.dirty()).toBeFalse();
    });

    it('exports JSON instead when the PDF is encrypted', async () => {
      await openDocument({ encrypted: true });

      await autosave.save();

      expect(codec.encode).not.toHaveBeenCalled();
      expect(files.download).toHaveBeenCalledWith(
        serializeAnnotations([]),
        'book.annotations.json',
        'application/json',
      );
    });

    it('does nothing without a document', async () => {
      await autosave.save();

      expect(files.download).not.toHaveBeenCalled();
      expect(files.overwrite).not.toHaveBeenCalled();
    });

    it('reports a failure as an error notice and keeps the changes unsaved', async () => {
      spyOn(console, 'error');
      await openDocument();
      annotator.add(selection());
      files.overwrite.and.rejectWith(new Error('disk full'));

      await autosave.save();

      expect(annotator.notice()).toEqual({
        key: 'NOTICE.ERROR',
        params: { message: 'disk full' },
      });
      expect(annotator.dirty()).toBeTrue();
      expect(autosave.busy()).toBeFalse();
    });

    it('keeps dirty when the document changes while it is being written', async () => {
      await openDocument();
      annotator.add(selection());
      const encode = deferred<Uint8Array>();
      codec.encode.and.returnValue(encode.promise);

      const saving = autosave.save();
      await flush();
      annotator.add(selection(2));
      encode.resolve(ENCODED);
      await saving;

      expect(files.overwrite).toHaveBeenCalledTimes(1);
      expect(annotator.dirty()).toBeTrue();
    });

    it('never runs two writes at the same time', async () => {
      await openDocument();
      annotator.add(selection());
      const first = deferred();
      let active = 0;
      let maxActive = 0;
      files.overwrite.and.callFake(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (files.overwrite.calls.count() === 1) await first.promise;
        active--;
      });

      const one = autosave.save();
      await flush();
      annotator.add(selection(2));
      const two = autosave.save();
      await flush();
      first.resolve();
      await Promise.all([one, two]);

      expect(files.overwrite).toHaveBeenCalledTimes(2);
      expect(maxActive).toBe(1);
    });

    it('asks for permission and, when denied, writes nothing and says why', async () => {
      await openDocument();
      annotator.add(selection());
      files.requestWritePermission.and.resolveTo(false);

      await autosave.save();

      expect(files.requestWritePermission).toHaveBeenCalledWith(handle);
      expect(files.overwrite).not.toHaveBeenCalled();
      expect(annotator.notice()).toEqual({ key: 'NOTICE.PERMISSION_DENIED' });
      expect(annotator.dirty()).toBeTrue();
    });

    it('leaves a replaced document alone', async () => {
      await openDocument();
      annotator.add(selection());
      const write = deferred();
      files.overwrite.and.returnValue(write.promise);

      const saving = autosave.save();
      await flush();
      await openDocument();
      write.resolve();
      await saving;

      expect(annotator.notice()).toBeNull();
      expect(autosave.saveStatus()).toBe('idle');
    });

    it('is busy only while a manual save runs', async () => {
      await openDocument();
      const write = deferred();
      files.overwrite.and.returnValue(write.promise);
      expect(autosave.busy()).toBeFalse();

      const saving = autosave.save();
      await flush();
      expect(autosave.busy()).toBeTrue();
      expect(annotator.busy()).toBeFalse();
      write.resolve();
      await saving;

      expect(autosave.busy()).toBeFalse();
    });
  });

  describe('saveStatus', () => {
    it('is idle before anything happens', async () => {
      await openDocument();

      expect(autosave.saveStatus()).toBe('idle');
    });

    it('is unsaved after a change and saved after a save', async () => {
      await openDocument();
      annotator.add(selection());
      expect(autosave.saveStatus()).toBe('unsaved');

      await autosave.save();

      expect(autosave.saveStatus()).toBe('saved');
    });

    it('is saving while a write is running', async () => {
      await openDocument();
      annotator.add(selection());
      const write = deferred();
      files.overwrite.and.returnValue(write.promise);

      const saving = autosave.save();
      await flush();
      expect(autosave.saveStatus()).toBe('saving');
      write.resolve();
      await saving;
    });

    it('is idle, and asks nothing, right after opening without write permission', async () => {
      await openDocument({ writeGranted: false });

      expect(autosave.saveStatus()).toBe('idle');
      expect(files.requestWritePermission).not.toHaveBeenCalled();
    });

    it('is saved after a manual save with autosave switched off', async () => {
      TestBed.inject(AutosavePreferenceService).set(false);
      await openDocument({ writeGranted: false });
      annotator.add(selection());
      expect(autosave.saveStatus()).toBe('unsaved');

      await autosave.save();

      expect(autosave.saveStatus()).toBe('saved');
    });

    it('is saved after a download, and unsaved again after the next change', async () => {
      await openDocument({ withHandle: false });
      annotator.add(selection());

      await autosave.save();
      expect(autosave.saveStatus()).toBe('saved');
      annotator.add(selection(2));

      expect(autosave.saveStatus()).toBe('unsaved');
    });

    it('starts over for every opened document', async () => {
      await openDocument();
      annotator.add(selection());
      await autosave.save();

      await openDocument();

      expect(autosave.saveStatus()).toBe('idle');
    });
  });

  describe('availability', () => {
    it('is available with a handle on a plain PDF', async () => {
      await openDocument();

      expect(autosave.autosaveAvailable()).toBeTrue();
      expect(autosave.autosaveActive()).toBeTrue();
    });

    it('is unavailable without a handle or for an encrypted PDF', async () => {
      await openDocument({ withHandle: false });
      expect(autosave.autosaveAvailable()).toBeFalse();

      await openDocument({ encrypted: true });
      expect(autosave.autosaveAvailable()).toBeFalse();
      expect(autosave.autosaveActive()).toBeFalse();
    });
  });

  describe('autosave scheduling', () => {
    let colorToggle = false;
    /** The fake clock the scheduler and the write timing read, moved by `advance`. */
    let now = 0;

    /** A real change that does not open the comment editor. */
    function recolor(): void {
      colorToggle = !colorToggle;
      annotator.changeColor('a', colorToggle ? '#00ff00' : '#ff0000');
      TestBed.tick();
    }

    /** Moves the fake clock and lets the promises it unblocks run. */
    async function advance(ms: number): Promise<void> {
      now += ms;
      jasmine.clock().tick(ms);
      await flush();
    }

    beforeEach(() => {
      jasmine.clock().install();
      colorToggle = false;
      now = 0;
      spyOn(performance, 'now').and.callFake(() => now);
    });

    afterEach(() => jasmine.clock().uninstall());

    describe('timing', () => {
      it('writes 3 s after a change, and not before', async () => {
        await openDocument({ annotations: [annotation('a')] });

        recolor();
        await advance(2999);
        expect(files.overwrite).not.toHaveBeenCalled();
        await advance(1);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
        expect(annotator.dirty()).toBeFalse();
        expect(autosave.saveStatus()).toBe('saved');
      });

      it('writes once for a burst of changes, 3 s after the last', async () => {
        await openDocument({ annotations: [annotation('a')] });

        for (let i = 0; i < 4; i++) {
          recolor();
          await advance(1000);
        }
        await advance(1999);
        expect(files.overwrite).not.toHaveBeenCalled();
        await advance(1);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('never lets a change wait longer than 30 s', async () => {
        await openDocument({ annotations: [annotation('a')] });

        for (let i = 0; i < 15; i++) {
          recolor();
          await advance(2000);
        }

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('does not schedule anything for selection, zoom, search or scrolling', async () => {
        await openDocument({ annotations: [annotation('a')] });

        annotator.select('a');
        annotator.setZoom(2);
        annotator.setSearch('x');
        TestBed.tick();
        await advance(60000);

        expect(files.overwrite).not.toHaveBeenCalled();
      });

      it('stretches the delay to twice the last write time (4 s -> 8 s)', async () => {
        files.overwrite.and.callFake(() => {
          now += 4000;
          return Promise.resolve();
        });
        await openDocument({ annotations: [annotation('a')] });

        recolor();
        await advance(3000);
        expect(files.overwrite).toHaveBeenCalledTimes(1);
        recolor();
        await advance(7999);
        expect(files.overwrite).toHaveBeenCalledTimes(1);
        await advance(1);

        expect(files.overwrite).toHaveBeenCalledTimes(2);
      });
    });

    describe('editor guard', () => {
      it('does not write at 3 s or 30 s while the editor is open', async () => {
        await openDocument();
        annotator.add(selection());
        TestBed.tick();

        await advance(3000);
        await advance(27000);

        expect(files.overwrite).not.toHaveBeenCalled();
      });

      it('writes at once when the editor closes after the save was deferred', async () => {
        await openDocument();
        annotator.add(selection());
        TestBed.tick();
        await advance(3000);

        annotator.stopEditing();
        TestBed.tick();
        await flush();

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('writes 3 s after a comment saved before the save was deferred', async () => {
        await openDocument();
        annotator.add(selection());
        TestBed.tick();
        await advance(1000);
        const [added] = annotator.annotations();

        annotator.updateComment(added.id, 'hello');
        TestBed.tick();
        await advance(2999);
        expect(files.overwrite).not.toHaveBeenCalled();
        await advance(1);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });
    });

    describe('toggle', () => {
      it('does not write while switched off, and remembers the choice', async () => {
        await openDocument({ annotations: [annotation('a')] });

        autosave.setAutosave(false);
        recolor();
        await advance(60000);

        expect(files.overwrite).not.toHaveBeenCalled();
        expect(localStorage.getItem(PREFERENCE_KEY)).toBe('false');
        expect(autosave.autosaveEnabled()).toBeFalse();
      });

      it('drops a save that was already scheduled when switched off', async () => {
        await openDocument({ annotations: [annotation('a')] });
        recolor();

        autosave.setAutosave(false);
        await advance(60000);

        expect(files.overwrite).not.toHaveBeenCalled();
      });

      it('clears a pause and writes pending changes when switched back on', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        files.requestWritePermission.and.resolveTo(false);
        recolor();
        await flush();
        expect(autosave.saveStatus()).toBe('paused');
        files.hasWritePermission.and.resolveTo(true);

        autosave.setAutosave(false);
        autosave.setAutosave(true);
        await advance(3000);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
        expect(autosave.saveStatus()).toBe('saved');
      });
    });

    describe('unavailable', () => {
      it('never schedules without a handle', async () => {
        await openDocument({ withHandle: false, annotations: [annotation('a')] });

        recolor();
        await advance(60000);

        expect(files.overwrite).not.toHaveBeenCalled();
        expect(files.download).not.toHaveBeenCalled();
      });

      it('never schedules for an encrypted PDF', async () => {
        await openDocument({ encrypted: true, annotations: [annotation('a')] });

        recolor();
        await advance(60000);

        expect(files.overwrite).not.toHaveBeenCalled();
      });
    });

    describe('pausing', () => {
      it('pauses without a notice when the permission is gone', async () => {
        await openDocument({ annotations: [annotation('a')] });
        files.hasWritePermission.and.resolveTo(false);

        recolor();
        await advance(3000);

        expect(files.overwrite).not.toHaveBeenCalled();
        expect(autosave.saveStatus()).toBe('paused');
        expect(annotator.notice()).toBeNull();
      });

      it('pauses and reports exactly one error when a write fails', async () => {
        spyOn(console, 'error');
        await openDocument({ annotations: [annotation('a')] });
        const report = spyOn(annotator, 'reportNotice').and.callThrough();
        files.overwrite.and.rejectWith(new Error('disk full'));

        recolor();
        await advance(3000);
        recolor();
        await advance(60000);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledOnceWith({
          key: 'NOTICE.ERROR',
          params: { message: 'disk full' },
        });
        expect(autosave.saveStatus()).toBe('paused');
      });

      it('resumes after a manual save', async () => {
        await openDocument({ annotations: [annotation('a')] });
        files.hasWritePermission.and.resolveTo(false);
        recolor();
        await advance(3000);
        files.hasWritePermission.and.resolveTo(true);

        await autosave.save();
        expect(autosave.saveStatus()).toBe('saved');
        recolor();
        await advance(3000);

        expect(files.overwrite).toHaveBeenCalledTimes(2);
      });
    });

    describe('ordering and manual saves during a write', () => {
      let gate: ReturnType<typeof deferred<void>>;

      /** Starts an autosave whose overwrite stays open until `gate` resolves. */
      async function startSlowAutosave(): Promise<void> {
        gate = deferred();
        files.overwrite.and.callFake(() =>
          files.overwrite.calls.count() === 1 ? gate.promise : Promise.resolve(),
        );
        recolor();
        await advance(3000);
        expect(autosave.saveStatus()).toBe('saving');
      }

      it('shares the running write when nothing changed since it began', async () => {
        await openDocument({ annotations: [annotation('a')] });
        await startSlowAutosave();

        const manual = autosave.save();
        await flush();
        gate.resolve();
        await manual;

        expect(files.overwrite).toHaveBeenCalledTimes(1);
        expect(annotator.notice()).toEqual({
          key: 'NOTICE.SAVED_IN',
          params: { name: 'book.pdf' },
        });
        expect(autosave.saveStatus()).toBe('saved');
      });

      it('writes again, after the running one, when something changed meanwhile', async () => {
        await openDocument({ annotations: [annotation('a')] });
        await startSlowAutosave();
        recolor();

        const manual = autosave.save();
        await flush();
        expect(files.overwrite).toHaveBeenCalledTimes(1);
        gate.resolve();
        await manual;

        expect(files.overwrite).toHaveBeenCalledTimes(2);
        expect(annotator.dirty()).toBeFalse();
        expect(autosave.saveStatus()).toBe('saved');
      });

      it('does its own write when the running one fails', async () => {
        spyOn(console, 'error');
        await openDocument({ annotations: [annotation('a')] });
        await startSlowAutosave();

        const manual = autosave.save();
        await flush();
        gate.reject(new Error('disk full'));
        await manual;

        expect(files.overwrite).toHaveBeenCalledTimes(2);
        expect(autosave.saveStatus()).toBe('saved');
        expect(annotator.notice()).toEqual({
          key: 'NOTICE.SAVED_IN',
          params: { name: 'book.pdf' },
        });
      });

      it('never runs two writes at the same time', async () => {
        await openDocument({ annotations: [annotation('a')] });
        let active = 0;
        let maxActive = 0;
        files.overwrite.and.callFake(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await Promise.resolve();
          await Promise.resolve();
          active--;
        });

        recolor();
        await advance(3000);
        recolor();
        const manual = autosave.save();
        recolor();
        await advance(3000);
        await manual;

        expect(files.overwrite.calls.count()).toBeGreaterThan(1);
        expect(maxActive).toBe(1);
      });
    });

    describe('flushes', () => {
      it('flushPendingSave writes even while the editor is open', async () => {
        await openDocument();
        annotator.add(selection());
        TestBed.tick();

        autosave.flushPendingSave();
        await flush();

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('flushPendingSave does nothing when clean or switched off', async () => {
        await openDocument({ annotations: [annotation('a')] });
        autosave.flushPendingSave();
        autosave.setAutosave(false);
        recolor();
        autosave.flushPendingSave();
        await flush();

        expect(files.overwrite).not.toHaveBeenCalled();
      });

      it('flushBeforeReplace is true when nothing is pending or autosave is off', async () => {
        await openDocument({ annotations: [annotation('a')] });
        expect(await autosave.flushBeforeReplace()).toBeTrue();

        autosave.setAutosave(false);
        recolor();
        expect(await autosave.flushBeforeReplace()).toBeTrue();
        expect(files.overwrite).not.toHaveBeenCalled();
      });

      it('flushBeforeReplace writes a pending change, even while editing, and says so', async () => {
        await openDocument();
        annotator.add(selection());
        TestBed.tick();

        expect(await autosave.flushBeforeReplace()).toBeTrue();

        expect(files.overwrite).toHaveBeenCalledTimes(1);
        expect(annotator.dirty()).toBeFalse();
      });

      it('flushBeforeReplace is false when the write fails or the permission is gone', async () => {
        spyOn(console, 'error');
        await openDocument({ annotations: [annotation('a')] });
        recolor();
        files.overwrite.and.rejectWith(new Error('disk full'));
        expect(await autosave.flushBeforeReplace()).toBeFalse();

        await openDocument({ annotations: [annotation('a')] });
        recolor();
        files.hasWritePermission.and.resolveTo(false);
        expect(await autosave.flushBeforeReplace()).toBeFalse();
      });
    });

    describe('first-change permission', () => {
      it('does not ask while the document is only read', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });

        annotator.select('a');
        annotator.setZoom(2);
        TestBed.tick();
        await advance(60000);

        expect(files.requestWritePermission).not.toHaveBeenCalled();
      });

      it('asks at once on the first change, before any timer, and writes after the delay', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });

        recolor();
        await flush();
        expect(files.requestWritePermission).toHaveBeenCalledOnceWith(handle);
        expect(files.overwrite).not.toHaveBeenCalled();
        await advance(3000);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('asks only once per document', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });

        recolor();
        await flush();
        await advance(3000);
        recolor();
        await advance(3000);

        expect(files.requestWritePermission).toHaveBeenCalledTimes(1);
        expect(files.overwrite).toHaveBeenCalledTimes(2);
      });

      it('never asks when access was already granted at open', async () => {
        await openDocument({ annotations: [annotation('a')] });

        recolor();
        await advance(3000);

        expect(files.requestWritePermission).not.toHaveBeenCalled();
        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('pauses quietly when denied, and never writes', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        files.requestWritePermission.and.resolveTo(false);

        recolor();
        await advance(3000);
        recolor();
        await advance(60000);

        expect(autosave.saveStatus()).toBe('paused');
        expect(annotator.notice()).toBeNull();
        expect(files.overwrite).not.toHaveBeenCalled();
        expect(files.requestWritePermission).toHaveBeenCalledTimes(1);
      });

      it('pauses quietly when the request throws', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        files.requestWritePermission.and.rejectWith(new Error('no gesture'));

        recolor();
        await flush();

        expect(autosave.saveStatus()).toBe('paused');
        expect(annotator.notice()).toBeNull();
      });

      it('waits for an unanswered prompt instead of pausing on the timer', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        const answer = deferred<boolean>();
        files.requestWritePermission.and.returnValue(answer.promise);

        recolor();
        recolor();
        await advance(10000);
        expect(files.overwrite).not.toHaveBeenCalled();
        expect(autosave.saveStatus()).not.toBe('paused');
        answer.resolve(true);
        await flush();
        await advance(3000);

        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('pauses silently when the tab is hidden before the prompt is answered', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        files.hasWritePermission.and.resolveTo(false);
        files.requestWritePermission.and.returnValue(new Promise<boolean>(() => undefined));

        recolor();
        autosave.flushPendingSave();
        await flush();

        expect(autosave.saveStatus()).toBe('paused');
        expect(files.overwrite).not.toHaveBeenCalled();
        expect(annotator.notice()).toBeNull();
      });

      it('asks on the first change when autosave is switched on again', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        autosave.setAutosave(false);
        recolor();
        expect(files.requestWritePermission).not.toHaveBeenCalled();

        autosave.setAutosave(true);
        await flush();
        await advance(3000);

        expect(files.requestWritePermission).toHaveBeenCalledTimes(1);
        expect(files.overwrite).toHaveBeenCalledTimes(1);
      });

      it('is settled by a manual save, so later changes do not ask', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        autosave.setAutosave(false);
        recolor();
        await autosave.save();
        files.requestWritePermission.calls.reset();
        autosave.setAutosave(true);

        recolor();
        await advance(3000);

        expect(files.requestWritePermission).not.toHaveBeenCalled();
      });

      describe('requestWriteAccess (before the import chooser)', () => {
        it('asks once, even though nothing has changed yet', async () => {
          await openDocument({ writeGranted: false });

          await autosave.requestWriteAccess();
          await autosave.requestWriteAccess();

          expect(files.requestWritePermission).toHaveBeenCalledOnceWith(handle);
        });

        it('pauses when denied, and later changes do not ask again', async () => {
          await openDocument({ writeGranted: false, annotations: [annotation('a')] });
          files.requestWritePermission.and.resolveTo(false);

          await autosave.requestWriteAccess();
          recolor();
          await flush();

          expect(autosave.saveStatus()).toBe('paused');
          expect(files.requestWritePermission).toHaveBeenCalledTimes(1);
        });

        it('does nothing when access is settled, autosave is off or unavailable', async () => {
          await openDocument();
          await autosave.requestWriteAccess();
          await openDocument({ withHandle: false });
          await autosave.requestWriteAccess();
          await openDocument({ writeGranted: false });
          autosave.setAutosave(false);
          await autosave.requestWriteAccess();

          expect(files.requestWritePermission).not.toHaveBeenCalled();
        });
      });
    });

    describe('recovery copy', () => {
      const IDENTITY = { name: 'book.pdf', pageCount: 3 };
      const RECOVERY_KEY = 'pdf-annotations.recovery.book.pdf|3';
      const WRITTEN_STAMP: FileStamp = { size: 77, lastModified: 4242 };
      let session: SessionStorageService;

      beforeEach(() => {
        session = TestBed.inject(SessionStorageService);
      });

      afterEach(() => localStorage.removeItem(RECOVERY_KEY));

      it('is kept for a document with no handle', async () => {
        await openDocument({ withHandle: false, annotations: [annotation('a')] });

        recolor();

        expect(session.readRecovery(IDENTITY)?.annotations.length).toBe(1);
      });

      it('is kept for an encrypted document that has a handle', async () => {
        await openDocument({ encrypted: true, annotations: [annotation('a')] });

        recolor();

        expect(session.readRecovery(IDENTITY)).not.toBeNull();
      });

      it('is kept once the first-change permission prompt is denied', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        files.requestWritePermission.and.resolveTo(false);

        recolor();
        await flush();
        TestBed.tick();

        expect(session.readRecovery(IDENTITY)).not.toBeNull();
      });

      it('is written the moment autosave pauses while the document is dirty', async () => {
        await openDocument({ annotations: [annotation('a')] });
        files.hasWritePermission.and.resolveTo(false);
        recolor();
        expect(session.readRecovery(IDENTITY)).toBeNull();

        await advance(3000);
        TestBed.tick();

        expect(autosave.saveStatus()).toBe('paused');
        expect(session.readRecovery(IDENTITY)).not.toBeNull();
      });

      it('is not written while autosave is active and healthy', async () => {
        await openDocument({ annotations: [annotation('a')] });

        recolor();
        await advance(3000);
        recolor();

        expect(session.readRecovery(IDENTITY)).toBeNull();
      });

      it('stays frozen once autosave is switched off, until the next save clears it', async () => {
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        recolor();
        const frozen = session.readRecovery(IDENTITY);

        autosave.setAutosave(false);
        TestBed.tick();
        recolor();
        expect(session.readRecovery(IDENTITY)).toEqual(frozen);

        await autosave.save();
        expect(session.readRecovery(IDENTITY)).toBeNull();
      });

      it('carries the baseline refreshed after autosave writes', async () => {
        await openDocument({ annotations: [annotation('a')] });
        files.stampOf.and.resolveTo(WRITTEN_STAMP);
        recolor();
        await advance(3000);
        expect(files.stampOf).toHaveBeenCalledOnceWith(handle);

        files.hasWritePermission.and.resolveTo(false);
        recolor();
        await advance(3000);
        TestBed.tick();

        expect(session.readRecovery(IDENTITY)?.baseline).toEqual(WRITTEN_STAMP);
      });

      it('keeps the old baseline, and still counts the write as saved, when the stamp is unreadable', async () => {
        await openDocument({ annotations: [annotation('a')] });
        files.stampOf.and.rejectWith(new Error('gone'));
        recolor();
        await advance(3000);

        expect(autosave.saveStatus()).toBe('saved');
        expect(annotator.notice()).toBeNull();
        files.hasWritePermission.and.resolveTo(false);
        recolor();
        await advance(3000);
        TestBed.tick();

        expect(session.readRecovery(IDENTITY)?.baseline).toEqual(STAMP);
      });

      it('is cleared by a successful manual save, a download, and kept by a failed one', async () => {
        spyOn(console, 'error');
        await openDocument({ writeGranted: false, annotations: [annotation('a')] });
        files.requestWritePermission.and.resolveTo(false);
        recolor();
        await flush();
        TestBed.tick();
        files.requestWritePermission.and.resolveTo(true);
        files.overwrite.and.rejectWith(new Error('disk full'));
        await autosave.save();
        expect(session.readRecovery(IDENTITY)).not.toBeNull();

        files.overwrite.and.resolveTo();
        await autosave.save();
        expect(session.readRecovery(IDENTITY)).toBeNull();

        await openDocument({ withHandle: false, annotations: [annotation('a')] });
        recolor();
        expect(session.readRecovery(IDENTITY)).not.toBeNull();
        await autosave.save();
        expect(session.readRecovery(IDENTITY)).toBeNull();
      });
    });
  });
});
