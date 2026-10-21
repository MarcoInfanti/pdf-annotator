import {
  forwardRef,
  provideZonelessChangeDetection,
  Component,
  input,
  output,
} from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { missingTranslationKeys } from '../testing/translation-keys/translation-keys';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import type {
  Annotation,
  DecodedPdf,
  PickedFile,
  ReadingPosition,
  TextSelection,
  ViewerPosition,
} from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { SessionStorageService } from '../../services/annotator/session-storage.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AutosaveSignals } from '../../signals/annotator/autosave.signals';
import { AnnotatorSidebarComponent } from '../annotator-sidebar/annotator-sidebar.component';
import { AnnotatorToolbarComponent } from '../annotator-toolbar/annotator-toolbar.component';
import { HIGHLIGHT_COLORS } from '../annotator.data';
import { PdfViewerComponent } from '../pdf-viewer/pdf-viewer.component';
import { AnnotatorComponent } from './annotator.component';

/** Stands in for the real viewer: pdf.js does not run in Karma. Same selector, inputs, outputs. */
@Component({
  selector: 'app-pdf-viewer',
  template: '',
  providers: [{ provide: PdfViewerComponent, useExisting: forwardRef(() => PdfViewerStub) }],
})
class PdfViewerStub {
  readonly data = input.required<Uint8Array>();
  readonly scale = input(1.25);
  readonly annotations = input<Annotation[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly textSelected = output<TextSelection>();
  readonly annotationClicked = output<string | null>();
  readonly zoomRequested = output<1 | -1>();
  readonly positionChanged = output<ViewerPosition>();
  readonly documentStartMeasured = output<ViewerPosition>();
  readonly fitWidthScale = jasmine.createSpy('fitWidthScale').and.returnValue(2);
  readonly scrollTo = jasmine.createSpy('scrollTo');
  readonly jumpTo = jasmine.createSpy('jumpTo').and.returnValue(true);
}

const POSITION_KEY = 'pdf-annotations.position.book.pdf|1';
const START: ViewerPosition = { page: 1, x: 0, y: 800 };
const STORED_POSITION: ReadingPosition = {
  page: 1,
  x: 5,
  y: 600,
  zoom: 1,
  updatedAt: '2024-01-01T00:00:00.000Z',
};
const BYTES = new Uint8Array([1, 2, 3]);
const SELECTION: TextSelection = {
  page: 1,
  rects: [[0, 0, 10, 10]],
  quote: 'quoted',
  clientX: 50,
  clientY: 60,
};

describe('AnnotatorComponent', () => {
  let fixture: ComponentFixture<AnnotatorComponent>;
  let store: AnnotatorSignals;
  let autosave: AutosaveSignals;
  let files: {
    [
      K in
        | 'pickPdf'
        | 'refresh'
        | 'overwrite'
        | 'hasWritePermission'
        | 'requestWritePermission'
        | 'stampOf'
    ]: jasmine.Spy<FileAccessService[K]>;
  };
  let codec: { [K in 'decode' | 'encode']: jasmine.Spy<PdfAnnotationCodecService[K]> };

  function byTestId(id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function stub(): PdfViewerStub {
    return fixture.debugElement.query(By.directive(PdfViewerStub))
      .componentInstance as PdfViewerStub;
  }

  function picked(name: string, withHandle = false): PickedFile {
    return {
      name,
      bytes: BYTES,
      handle: withHandle ? ({} as FileSystemFileHandle) : null,
      stamp: { size: 3, lastModified: 1 },
      writeGranted: withHandle,
    };
  }

  async function openDocument(options: { withHandle?: boolean } = {}): Promise<void> {
    const decoded: DecodedPdf = {
      cleanBytes: BYTES,
      annotations: [],
      encrypted: false,
      pageCount: 1,
      position: null,
    };
    files.pickPdf.and.resolveTo(picked('book.pdf', options.withHandle));
    codec.decode.and.resolveTo(decoded);
    await store.open();
    fixture.detectChanges();
  }

  function pressKey(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
    window.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  function selectText(): void {
    stub().textSelected.emit(SELECTION);
    fixture.detectChanges();
  }

  beforeEach(() => {
    files = {
      pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf'),
      refresh: jasmine
        .createSpy<FileAccessService['refresh']>('refresh')
        .and.callFake((picked) => Promise.resolve(picked)),
      overwrite: jasmine.createSpy<FileAccessService['overwrite']>('overwrite').and.resolveTo(),
      hasWritePermission: jasmine
        .createSpy<FileAccessService['hasWritePermission']>('hasWritePermission')
        .and.resolveTo(true),
      requestWritePermission: jasmine
        .createSpy<FileAccessService['requestWritePermission']>('requestWritePermission')
        .and.resolveTo(true),
      stampOf: jasmine
        .createSpy<FileAccessService['stampOf']>('stampOf')
        .and.resolveTo({ size: 3, lastModified: 1 }),
    };
    codec = {
      decode: jasmine.createSpy<PdfAnnotationCodecService['decode']>('decode'),
      encode: jasmine
        .createSpy<PdfAnnotationCodecService['encode']>('encode')
        .and.resolveTo(new Uint8Array([9])),
    };
    TestBed.configureTestingModule({
      imports: [AnnotatorComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: FileAccessService, useValue: files },
        { provide: PdfAnnotationCodecService, useValue: codec },
      ],
    }).overrideComponent(AnnotatorComponent, {
      remove: { imports: [PdfViewerComponent] },
      add: { imports: [PdfViewerStub] },
    });
    fixture = TestBed.createComponent(AnnotatorComponent);
    store = fixture.debugElement.injector.get(AnnotatorSignals);
    autosave = fixture.debugElement.injector.get(AutosaveSignals);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('pdf-annotations.reading-mode');
    localStorage.removeItem('pdf-annotations.sidebar-width');
    localStorage.removeItem(POSITION_KEY);
    localStorage.removeItem('pdf-annotations.recovery.book.pdf|1');
    localStorage.removeItem('pdf-annotations.autosave');
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows the empty state, and no workspace, without a document', () => {
    expect(byTestId('annotator-empty-state')).not.toBeNull();
    expect(byTestId('annotator-workspace')).toBeNull();
  });

  it('opens a PDF from the empty-state button', () => {
    files.pickPdf.and.resolveTo(null);

    byTestId('annotator-empty-open')?.click();

    expect(files.pickPdf).toHaveBeenCalledTimes(1);
  });

  it('shows the workspace once a document is open', async () => {
    await openDocument();

    expect(byTestId('annotator-workspace')).not.toBeNull();
    expect(byTestId('annotator-empty-state')).toBeNull();
  });

  it('shows the notice and dismisses it', async () => {
    spyOn(console, 'error');
    files.pickPdf.and.rejectWith(new Error('boom'));
    await store.open();
    fixture.detectChanges();
    expect(byTestId('annotator-notice')?.textContent).toContain('NOTICE.ERROR');

    byTestId('annotator-notice-dismiss')?.click();
    fixture.detectChanges();

    expect(byTestId('annotator-notice')).toBeNull();
  });

  describe('opening while there are unsaved changes', () => {
    beforeEach(async () => {
      await openDocument();
      store.add(SELECTION);
      fixture.detectChanges();
      files.pickPdf.calls.reset();
      files.pickPdf.and.resolveTo(null);
    });

    it('does not pick a file when the user declines to discard them', () => {
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

      byTestId('annotator-toolbar-open')?.click();

      expect(confirmSpy).toHaveBeenCalledWith('CONFIRM.DISCARD_CHANGES');
      expect(files.pickPdf).not.toHaveBeenCalled();
    });

    it('picks a file when the user confirms', () => {
      spyOn(window, 'confirm').and.returnValue(true);

      byTestId('annotator-toolbar-open')?.click();

      expect(files.pickPdf).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard shortcuts', () => {
    it('saves on Ctrl+S and prevents the browser default', () => {
      const save = spyOn(autosave, 'save').and.resolveTo();

      const event = pressKey({ key: 's', ctrlKey: true });

      expect(save).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBeTrue();
    });

    it('zooms on Ctrl +, - and 0 when a document is open', async () => {
      await openDocument();

      pressKey({ key: '+', ctrlKey: true });
      expect(store.scale()).toBe(1.5);

      pressKey({ key: '-', ctrlKey: true });
      expect(store.scale()).toBe(1.25);

      pressKey({ key: '0', ctrlKey: true });
      expect(store.scale()).toBe(1);
    });

    it('leaves the browser zoom alone when no document is open', () => {
      const event = pressKey({ key: '+', ctrlKey: true });

      expect(store.scale()).toBe(1.25);
      expect(event.defaultPrevented).toBeFalse();
    });

    it('closes the highlight popup on Escape', async () => {
      await openDocument();
      selectText();
      expect(fixture.debugElement.query(By.css('app-highlight-popup'))).not.toBeNull();

      pressKey({ key: 'Escape' });

      expect(fixture.debugElement.query(By.css('app-highlight-popup'))).toBeNull();
    });
  });

  describe('beforeunload', () => {
    /**
     * Calls the handler directly: dispatching a real beforeunload on window trips Karma's own
     * "full page reload" guard.
     */
    function unload(): Event {
      const event = new Event('beforeunload', { cancelable: true });
      fixture.componentInstance['warnUnsaved'](event);
      return event;
    }

    it('is not prevented while the document is clean', async () => {
      await openDocument();

      expect(unload().defaultPrevented).toBeFalse();
    });

    it('is prevented while a write is in flight, even when clean', async () => {
      await openDocument({ withHandle: true });
      let finish!: () => void;
      files.overwrite.and.returnValue(new Promise<void>((resolve) => (finish = resolve)));

      const saving = autosave.save();
      await new Promise((resolve) => setTimeout(resolve));
      expect(autosave.saveStatus()).toBe('saving');
      expect(unload().defaultPrevented).toBeTrue();
      finish();
      await saving;
    });

    it('is prevented while there are unsaved changes', async () => {
      await openDocument();
      store.add(SELECTION);

      expect(unload().defaultPrevented).toBeTrue();
    });
  });

  describe('highlighting', () => {
    it('shows the popup for a text selection', async () => {
      await openDocument();

      selectText();

      expect(fixture.debugElement.query(By.css('app-highlight-popup'))).not.toBeNull();
    });

    it('adds the annotation, closes the popup and clears the browser selection', async () => {
      await openDocument();
      const paragraph = document.createElement('p');
      paragraph.textContent = 'some text';
      document.body.appendChild(paragraph);
      document.getSelection()?.selectAllChildren(paragraph);
      expect(String(document.getSelection())).toBe('some text');
      selectText();

      byTestId(`highlight-popup-color-${HIGHLIGHT_COLORS[1].id}`)?.click();
      fixture.detectChanges();

      expect(store.annotations().length).toBe(1);
      expect(store.annotations()[0].color).toBe(HIGHLIGHT_COLORS[1].value);
      expect(fixture.debugElement.query(By.css('app-highlight-popup'))).toBeNull();
      // rangeCount is not reliable here: Chrome keeps one collapsed range when a textarea has focus
      expect(String(document.getSelection())).toBe('');
      paragraph.remove();
    });

    it('selects the clicked annotation and closes the popup', async () => {
      await openDocument();
      store.add(SELECTION);
      const id = store.selectedId()!;
      store.select(null);
      selectText();

      stub().annotationClicked.emit(id);
      fixture.detectChanges();

      expect(store.selectedId()).toBe(id);
      expect(fixture.debugElement.query(By.css('app-highlight-popup'))).toBeNull();
    });
  });

  describe('opening with autosave on', () => {
    /** Lets the promise chains of the open flow run to the end. */
    async function settle(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve));
    }

    beforeEach(async () => {
      await openDocument({ withHandle: true });
      store.add(SELECTION);
      fixture.detectChanges();
      files.pickPdf.calls.reset();
      codec.decode.calls.reset();
    });

    function clickOpen(): void {
      byTestId('annotator-toolbar-open')?.click();
    }

    it('picks first, saves the pending change, and loads without asking', async () => {
      const confirmSpy = spyOn(window, 'confirm');
      files.pickPdf.and.resolveTo(picked('next.pdf'));

      clickOpen();
      await settle();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(files.overwrite).toHaveBeenCalledTimes(1);
      expect(codec.decode).toHaveBeenCalledTimes(1);
      expect(store.document()?.name).toBe('next.pdf');
    });

    it('loads the bytes read again after the save, not the ones read when picking', async () => {
      const stale = picked('book.pdf', true);
      const fresh = { ...stale, bytes: new Uint8Array([8, 8]) };
      files.pickPdf.and.resolveTo(stale);
      files.refresh.and.resolveTo(fresh);

      clickOpen();
      await settle();

      expect(files.refresh).toHaveBeenCalledOnceWith(stale);
      expect(codec.decode).toHaveBeenCalledOnceWith(fresh.bytes);
    });

    it('loads nothing when the file cannot be read again', async () => {
      spyOn(console, 'error');
      files.pickPdf.and.resolveTo(picked('next.pdf'));
      files.refresh.and.rejectWith(new Error('gone'));

      clickOpen();
      await settle();

      expect(codec.decode).not.toHaveBeenCalled();
      expect(store.document()?.name).toBe('book.pdf');
    });

    it('asks to discard when the save fails, and loads nothing if declined', async () => {
      spyOn(console, 'error');
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
      files.overwrite.and.rejectWith(new Error('disk full'));
      files.pickPdf.and.resolveTo(picked('next.pdf'));

      clickOpen();
      await settle();

      expect(confirmSpy).toHaveBeenCalledWith('CONFIRM.DISCARD_CHANGES');
      expect(codec.decode).not.toHaveBeenCalled();
      expect(store.document()?.name).toBe('book.pdf');
      expect(store.dirty()).toBeTrue();
    });

    it('loads the picked file when the user agrees to discard after a failed save', async () => {
      spyOn(console, 'error');
      spyOn(window, 'confirm').and.returnValue(true);
      files.overwrite.and.rejectWith(new Error('disk full'));
      files.pickPdf.and.resolveTo(picked('next.pdf'));

      clickOpen();
      await settle();

      expect(store.document()?.name).toBe('next.pdf');
    });

    it('does nothing when the picker is cancelled', async () => {
      const confirmSpy = spyOn(window, 'confirm');
      files.pickPdf.and.resolveTo(null);

      clickOpen();
      await settle();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(files.overwrite).not.toHaveBeenCalled();
      expect(store.document()?.name).toBe('book.pdf');
    });
  });

  describe('visibility change', () => {
    function changeVisibility(state: DocumentVisibilityState): void {
      spyOnProperty(document, 'visibilityState').and.returnValue(state);
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('flushes a pending save when the tab becomes hidden', () => {
      const flush = spyOn(autosave, 'flushPendingSave');

      changeVisibility('hidden');

      expect(flush).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the tab becomes visible', () => {
      const flush = spyOn(autosave, 'flushPendingSave');

      changeVisibility('visible');

      expect(flush).not.toHaveBeenCalled();
    });
  });

  describe('viewer outputs', () => {
    it('stores the reading position the viewer reports, without making the document dirty', async () => {
      await openDocument();

      stub().positionChanged.emit({ page: 2, x: 3, y: 4 });

      expect(store.position()).toEqual(jasmine.objectContaining({ page: 2, x: 3, y: 4 }));
      expect(store.dirty()).toBeFalse();
    });

    it('stores the measured start of the document', async () => {
      localStorage.setItem(POSITION_KEY, JSON.stringify(STORED_POSITION));
      await openDocument();
      expect(store.resumeOffer()).toBeNull();

      stub().documentStartMeasured.emit(START);

      expect(store.resumeOffer()).toEqual(STORED_POSITION);
    });
  });

  describe('resume bar', () => {
    async function openWithOffer(): Promise<void> {
      localStorage.setItem(POSITION_KEY, JSON.stringify(STORED_POSITION));
      await openDocument();
      stub().documentStartMeasured.emit(START);
      fixture.detectChanges();
    }

    it('is a labelled group, apart from the notice bar', async () => {
      await openWithOffer();

      const bar = byTestId('annotator-resume');
      expect(bar?.getAttribute('role')).toBe('group');
      const label = byTestId('annotator-resume-continue');
      expect(bar?.getAttribute('aria-labelledby')).toBe(label?.id);
      expect(label?.id).toBeTruthy();
      expect(byTestId('annotator-notice')).toBeNull();
    });

    it('is not shown without an offer', async () => {
      await openDocument();

      expect(byTestId('annotator-resume')).toBeNull();
    });

    it('jumps to the position and hides when Continue is pressed', async () => {
      await openWithOffer();
      stub().jumpTo.and.returnValue(true);

      byTestId('annotator-resume-continue')?.click();
      fixture.detectChanges();

      expect(stub().jumpTo).toHaveBeenCalledOnceWith(STORED_POSITION);
      expect(byTestId('annotator-resume')).toBeNull();
    });

    it('stays when the viewer cannot jump yet', async () => {
      await openWithOffer();
      stub().jumpTo.and.returnValue(false);

      byTestId('annotator-resume-continue')?.click();
      fixture.detectChanges();

      expect(byTestId('annotator-resume')).not.toBeNull();
    });

    it('hides when dismissed', async () => {
      await openWithOffer();

      byTestId('annotator-resume-dismiss')?.click();
      fixture.detectChanges();

      expect(byTestId('annotator-resume')).toBeNull();
      expect(stub().jumpTo).not.toHaveBeenCalled();
    });
  });

  describe('recovery bar', () => {
    const IDENTITY = { name: 'book.pdf', pageCount: 1 };
    const RECOVERY_KEY = 'pdf-annotations.recovery.book.pdf|1';

    async function openWithCopy(): Promise<void> {
      const copy: Annotation = {
        id: 'x',
        page: 1,
        rects: [[0, 0, 10, 10]],
        quote: 'q',
        comment: 'kept',
        color: '#ffd54f',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      TestBed.inject(SessionStorageService).writeRecovery(IDENTITY, [copy], {
        size: 3,
        lastModified: 1,
      });
      await openDocument();
    }

    afterEach(() => localStorage.removeItem(RECOVERY_KEY));

    it('is a labelled group, apart from the notice bar', async () => {
      await openWithCopy();

      const bar = byTestId('annotator-recovery');
      expect(bar?.getAttribute('role')).toBe('group');
      const labelId = bar?.getAttribute('aria-labelledby') ?? '';
      expect(bar?.querySelector(`#${labelId}`)).not.toBeNull();
      expect(byTestId('annotator-notice')).toBeNull();
    });

    it('restores the annotations and hides when the button is pressed', async () => {
      await openWithCopy();

      byTestId('annotator-recovery-restore')?.click();
      fixture.detectChanges();

      expect(store.annotations().map((a) => a.id)).toEqual(['x']);
      expect(store.dirty()).toBeTrue();
      expect(byTestId('annotator-recovery')).toBeNull();
    });

    it('hides when dismissed and keeps the copy', async () => {
      await openWithCopy();

      byTestId('annotator-recovery-dismiss')?.click();
      fixture.detectChanges();

      expect(byTestId('annotator-recovery')).toBeNull();
      expect(localStorage.getItem(RECOVERY_KEY)).not.toBeNull();
    });

    it('is not shown without a copy', async () => {
      await openDocument();

      expect(byTestId('annotator-recovery')).toBeNull();
    });
  });

  it('selects the annotation and scrolls the viewer when the sidebar asks to focus it', async () => {
    await openDocument();
    store.add(SELECTION);
    const annotation = store.annotations()[0];
    store.select(null);
    const sidebar = fixture.debugElement.query(By.directive(AnnotatorSidebarComponent))
      .componentInstance as AnnotatorSidebarComponent;

    sidebar.annotationFocused.emit(annotation);

    expect(store.selectedId()).toBe(annotation.id);
    expect(stub().scrollTo).toHaveBeenCalledOnceWith(annotation);
  });

  it('sets the scale the viewer reports when the toolbar asks to fit the width', async () => {
    await openDocument();
    const toolbar = fixture.debugElement.query(By.directive(AnnotatorToolbarComponent))
      .componentInstance as AnnotatorToolbarComponent;

    toolbar.fitWidthRequested.emit();

    expect(store.scale()).toBe(2);
  });

  it('only uses translation keys that exist in both bundles', () => {
    const keys = [
      'NOTICE.DISMISS',
      'EMPTY.TITLE',
      'EMPTY.INTRO',
      'EMPTY.STORAGE_BEFORE',
      'EMPTY.STORAGE_STRONG',
      'EMPTY.STORAGE_AFTER',
      'TOOLBAR.OPEN',
      'CONFIRM.DISCARD_CHANGES',
      'NOTICE.RESUME',
      'NOTICE.RESUME_DISMISS',
      'NOTICE.RECOVERY',
      'NOTICE.RECOVERY_ACTION',
      'NOTICE.RECOVERY_DISMISS',
      'NOTICE.PERMISSION_DENIED',
    ];

    expect(missingTranslationKeys(keys)).toEqual([]);
  });
});
