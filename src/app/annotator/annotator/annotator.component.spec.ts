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
import type {
  Annotation,
  DecodedPdf,
  PickedFile,
  TextSelection,
} from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
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
  readonly fitWidthScale = jasmine.createSpy('fitWidthScale').and.returnValue(2);
  readonly scrollTo = jasmine.createSpy('scrollTo');
}

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
  let files: { pickPdf: jasmine.Spy<FileAccessService['pickPdf']> };
  let codec: { decode: jasmine.Spy<PdfAnnotationCodecService['decode']> };

  function byTestId(id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function stub(): PdfViewerStub {
    return fixture.debugElement.query(By.directive(PdfViewerStub))
      .componentInstance as PdfViewerStub;
  }

  async function openDocument(): Promise<void> {
    const picked: PickedFile = { name: 'book.pdf', bytes: BYTES, handle: null };
    const decoded: DecodedPdf = { cleanBytes: BYTES, annotations: [], encrypted: false };
    files.pickPdf.and.resolveTo(picked);
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
    files = { pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf') };
    codec = { decode: jasmine.createSpy<PdfAnnotationCodecService['decode']>('decode') };
    TestBed.configureTestingModule({
      imports: [AnnotatorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FileAccessService, useValue: files },
        { provide: PdfAnnotationCodecService, useValue: codec },
      ],
    }).overrideComponent(AnnotatorComponent, {
      remove: { imports: [PdfViewerComponent] },
      add: { imports: [PdfViewerStub] },
    });
    fixture = TestBed.createComponent(AnnotatorComponent);
    store = fixture.debugElement.injector.get(AnnotatorSignals);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('pdf-annotations.reading-mode');
    localStorage.removeItem('pdf-annotations.sidebar-width');
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
    expect(byTestId('annotator-notice')?.textContent).toContain('boom');

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
      spyOn(window, 'confirm').and.returnValue(false);

      byTestId('annotator-toolbar-open')?.click();

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
      const save = spyOn(store, 'save').and.resolveTo();

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
});
