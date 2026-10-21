import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  Annotation,
  DecodedPdf,
  FileStamp,
  PickedFile,
  ReadingPosition,
  TextSelection,
} from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { AnnotatorSignals } from './annotator.signals';
import { AutosaveSignals } from './autosave.signals';

const BYTES = new Uint8Array([1, 2, 3]);
const STAMP: FileStamp = { size: 3, lastModified: 1000 };
const POSITION_A = 'pdf-annotations.position.a.pdf|3';
const POSITION_B = 'pdf-annotations.position.b.pdf|3';
const RECOVERY_A = 'pdf-annotations.recovery.a.pdf|3';

function selection(): TextSelection {
  return { page: 1, rects: [[0, 0, 10, 10]], quote: 'q', clientX: 0, clientY: 0 };
}

function savedPosition(page: number): ReadingPosition {
  return { page, x: 0, y: 100, zoom: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
}

/** Lets pending promise callbacks run, including chains of a few awaits. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * Cases the step-by-step specs of the two stores do not combine: the editor guard meeting a lost
 * permission, a switch-off or another document; and per-document state that must not leak.
 */
describe('AnnotatorSignals + AutosaveSignals, combined edge cases', () => {
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
  let now: number;

  async function open(name = 'a.pdf', position: ReadingPosition | null = null): Promise<void> {
    const picked: PickedFile = {
      name,
      bytes: BYTES,
      handle: {} as FileSystemFileHandle,
      stamp: STAMP,
      writeGranted: true,
    };
    const decoded: DecodedPdf = {
      cleanBytes: BYTES,
      annotations: [] as Annotation[],
      encrypted: false,
      pageCount: 3,
      position,
    };
    files.pickPdf.and.resolveTo(picked);
    codec.decode.and.resolveTo(decoded);
    await annotator.open();
    TestBed.tick();
  }

  async function advance(ms: number): Promise<void> {
    now += ms;
    jasmine.clock().tick(ms);
    await flush();
  }

  beforeEach(() => {
    localStorage.clear();
    jasmine.clock().install();
    now = 0;
    spyOn(performance, 'now').and.callFake(() => now);
    files = {
      pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf'),
      pickText: jasmine.createSpy<FileAccessService['pickText']>('pickText'),
      overwrite: jasmine.createSpy<FileAccessService['overwrite']>('overwrite').and.resolveTo(),
      download: jasmine.createSpy<FileAccessService['download']>('download'),
      hasWritePermission: jasmine
        .createSpy<FileAccessService['hasWritePermission']>('hasWritePermission')
        .and.resolveTo(true),
      requestWritePermission: jasmine
        .createSpy<FileAccessService['requestWritePermission']>('requestWritePermission')
        .and.resolveTo(true),
      stampOf: jasmine.createSpy<FileAccessService['stampOf']>('stampOf').and.resolveTo(STAMP),
    };
    codec = {
      decode: jasmine.createSpy<PdfAnnotationCodecService['decode']>('decode'),
      encode: jasmine
        .createSpy<PdfAnnotationCodecService['encode']>('encode')
        .and.resolveTo(new Uint8Array([9])),
    };
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
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  describe('a save deferred by the editor guard', () => {
    /** Opens the editor, lets the 3 s pass while it is open, and leaves the save deferred. */
    async function deferSave(): Promise<void> {
      await open();
      annotator.add(selection());
      TestBed.tick();
      await advance(3000);
      expect(files.overwrite).not.toHaveBeenCalled();
    }

    it('pauses quietly, without writing, when the permission is gone by the time the editor closes', async () => {
      await deferSave();
      files.hasWritePermission.and.resolveTo(false);

      annotator.stopEditing();
      TestBed.tick();
      await flush();

      expect(files.overwrite).not.toHaveBeenCalled();
      expect(autosave.saveStatus()).toBe('paused');
      expect(annotator.notice()).toBeNull();
    });

    it('is forgotten when autosave is switched off, so closing the editor writes nothing', async () => {
      await deferSave();

      autosave.setAutosave(false);
      annotator.stopEditing();
      TestBed.tick();
      await flush();
      await advance(60_000);

      expect(files.overwrite).not.toHaveBeenCalled();
      expect(autosave.saveStatus()).toBe('unsaved');
    });

    it('is forgotten when another document is opened, so it never writes into the new one', async () => {
      await deferSave();

      await open('b.pdf');
      annotator.stopEditing();
      TestBed.tick();
      await flush();
      await advance(60_000);

      expect(files.overwrite).not.toHaveBeenCalled();
    });

    it('is still written by the max wait after the editor closes later than 30 s', async () => {
      await deferSave();
      await advance(60_000);
      expect(files.overwrite).not.toHaveBeenCalled();

      annotator.stopEditing();
      TestBed.tick();
      await flush();

      expect(files.overwrite).toHaveBeenCalledTimes(1);
    });
  });

  describe('without a document', () => {
    it('switching autosave on or off does not throw or write anything', async () => {
      expect(() => autosave.setAutosave(false)).not.toThrow();
      expect(() => autosave.setAutosave(true)).not.toThrow();
      TestBed.tick();
      await advance(60_000);

      expect(files.overwrite).not.toHaveBeenCalled();
      expect(autosave.saveStatus()).toBe('idle');
    });

    it('flushing writes nothing and resolves true', async () => {
      autosave.flushPendingSave();

      expect(await autosave.flushBeforeReplace()).toBeTrue();
      expect(files.overwrite).not.toHaveBeenCalled();
    });

    it('setPosition, recover and dismissals are quiet no-ops', () => {
      annotator.setPosition({ page: 2, x: 0, y: 0 });
      annotator.recover();
      annotator.dismissRecovery();
      annotator.dismissResume();

      expect(annotator.position()).toBeNull();
      expect(localStorage.length).toBe(0);
    });
  });

  describe('per-document state', () => {
    it('does not carry the reading position of one document into the next', async () => {
      await open('a.pdf');
      annotator.setPosition({ page: 2, x: 5, y: 50 });
      expect(localStorage.getItem(POSITION_A)).not.toBeNull();

      await open('b.pdf');
      annotator.setDocumentStart({ page: 1, x: 0, y: 600 });

      expect(annotator.position()).toBeNull();
      expect(annotator.resumeOffer()).toBeNull();
      expect(localStorage.getItem(POSITION_B)).toBeNull();
    });

    it('offers the remembered position again when the same file is opened again after a dismissal', async () => {
      localStorage.setItem(POSITION_A, JSON.stringify(savedPosition(2)));
      await open('a.pdf');
      annotator.setDocumentStart({ page: 1, x: 0, y: 600 });
      expect(annotator.resumeOffer()?.page).toBe(2);

      annotator.dismissResume();
      expect(annotator.resumeOffer()).toBeNull();
      await open('a.pdf');
      annotator.setDocumentStart({ page: 1, x: 0, y: 600 });

      expect(annotator.resumeOffer()?.page).toBe(2);
    });

    it('a stale revision does not clear the recovery copy, and the current one does', async () => {
      await open('a.pdf');
      annotator.setRecoveryEnabled(true);
      annotator.add(selection());
      const stale = annotator.revision();
      annotator.add(selection());
      expect(localStorage.getItem(RECOVERY_A)).not.toBeNull();

      annotator.markSaved(stale);
      expect(localStorage.getItem(RECOVERY_A)).not.toBeNull();
      expect(annotator.dirty()).toBeTrue();

      annotator.markSaved(annotator.revision());
      expect(localStorage.getItem(RECOVERY_A)).toBeNull();
      expect(annotator.dirty()).toBeFalse();
    });

    it('a recovery copy is applied once: recovering twice does not duplicate or re-dirty', async () => {
      const stored = {
        baseline: { size: 99, lastModified: 99 },
        annotations: JSON.stringify({
          version: 1,
          annotations: [
            {
              id: 'x',
              page: 1,
              rects: [[0, 0, 5, 5]],
              quote: 'q',
              comment: 'c',
              color: '#ffd54f',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        }),
      };
      localStorage.setItem(RECOVERY_A, JSON.stringify(stored));
      await open('a.pdf');
      expect(annotator.recoveryOffer()).not.toBeNull();

      annotator.recover();
      const revision = annotator.revision();
      annotator.recover();

      expect(annotator.annotations().map((a) => a.id)).toEqual(['x']);
      expect(annotator.revision()).toBe(revision);
      expect(annotator.recoveryOffer()).toBeNull();
    });
  });
});
