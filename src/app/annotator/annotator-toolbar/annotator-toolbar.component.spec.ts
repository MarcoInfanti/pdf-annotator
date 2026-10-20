import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { DecodedPdf, PickedFile } from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { ReadingModeService } from '../../services/layout/reading-mode.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AnnotatorToolbarComponent } from './annotator-toolbar.component';

const BYTES = new Uint8Array([1, 2, 3]);

describe('AnnotatorToolbarComponent', () => {
  let fixture: ComponentFixture<AnnotatorToolbarComponent>;
  let store: AnnotatorSignals;
  let files: { pickPdf: jasmine.Spy<FileAccessService['pickPdf']> };
  let codec: { decode: jasmine.Spy<PdfAnnotationCodecService['decode']> };

  function byTestId(id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function click(id: string): void {
    byTestId(id)?.click();
    fixture.detectChanges();
  }

  async function openDocument(encrypted = false): Promise<void> {
    const picked: PickedFile = { name: 'book.pdf', bytes: BYTES, handle: null };
    const decoded: DecodedPdf = { cleanBytes: BYTES, annotations: [], encrypted };
    files.pickPdf.and.resolveTo(picked);
    codec.decode.and.resolveTo(decoded);
    await store.open();
    fixture.detectChanges();
  }

  beforeEach(() => {
    files = { pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf') };
    codec = { decode: jasmine.createSpy<PdfAnnotationCodecService['decode']>('decode') };
    TestBed.configureTestingModule({
      imports: [AnnotatorToolbarComponent],
      providers: [
        provideZonelessChangeDetection(),
        AnnotatorSignals,
        { provide: FileAccessService, useValue: files },
        { provide: PdfAnnotationCodecService, useValue: codec },
      ],
    });
    store = TestBed.inject(AnnotatorSignals);
    fixture = TestBed.createComponent(AnnotatorToolbarComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('pdf-annotations.reading-mode');
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows only the open button without a document', () => {
    expect(byTestId('annotator-toolbar-open')).not.toBeNull();
    expect(byTestId('annotator-toolbar-save')).toBeNull();
    expect(byTestId('annotator-toolbar-zoom')).toBeNull();
  });

  it('emits openRequested when the open button is clicked', () => {
    const emitted = jasmine.createSpy('openRequested');
    fixture.componentInstance.openRequested.subscribe(emitted);

    click('annotator-toolbar-open');

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('calls the store from save, save-copy, export and import', async () => {
    await openDocument();
    const save = spyOn(store, 'save').and.resolveTo();
    const saveCopy = spyOn(store, 'saveCopy').and.resolveTo();
    const exportJson = spyOn(store, 'exportJson');
    const importJson = spyOn(store, 'importJson').and.resolveTo();

    click('annotator-toolbar-save');
    click('annotator-toolbar-save-copy');
    click('annotator-toolbar-export-json');
    click('annotator-toolbar-import-json');

    expect(save).toHaveBeenCalledTimes(1);
    expect(saveCopy).toHaveBeenCalledTimes(1);
    expect(exportJson).toHaveBeenCalledTimes(1);
    expect(importJson).toHaveBeenCalledTimes(1);
  });

  it('hides save-copy for an encrypted PDF', async () => {
    await openDocument(true);

    expect(byTestId('annotator-toolbar-save')).not.toBeNull();
    expect(byTestId('annotator-toolbar-save-copy')).toBeNull();
  });

  it('shows the file name, and the unsaved indicator only when dirty', async () => {
    await openDocument();
    expect(byTestId('annotator-toolbar-file-name')?.textContent).toContain('book.pdf');
    expect(byTestId('annotator-toolbar-dirty')).toBeNull();

    store.add({ page: 1, rects: [[0, 0, 1, 1]], quote: 'q', clientX: 0, clientY: 0 });
    fixture.detectChanges();

    expect(byTestId('annotator-toolbar-dirty')).not.toBeNull();
  });

  it('zooms through the store from the + and - buttons', async () => {
    await openDocument();
    const zoom = spyOn(store, 'zoom').and.callThrough();

    click('annotator-toolbar-zoom-in');
    click('annotator-toolbar-zoom-out');

    expect(zoom.calls.allArgs()).toEqual([[1], [-1]]);
  });

  it('sets the scale from the select, and asks the page to fit the width for "fit"', async () => {
    await openDocument();
    const fit = jasmine.createSpy('fitWidthRequested');
    fixture.componentInstance.fitWidthRequested.subscribe(fit);
    const select = byTestId('annotator-toolbar-zoom-select') as HTMLSelectElement;

    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(store.scale()).toBe(2);
    expect(fit).not.toHaveBeenCalled();

    select.value = 'fit';
    select.dispatchEvent(new Event('change'));
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('emits fitWidthRequested from the fit-width button', async () => {
    await openDocument();
    const fit = jasmine.createSpy('fitWidthRequested');
    fixture.componentInstance.fitWidthRequested.subscribe(fit);

    click('annotator-toolbar-fit-width');

    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('switches the reading mode and reflects it in aria-pressed', async () => {
    await openDocument();
    const set = spyOn(TestBed.inject(ReadingModeService), 'set').and.callThrough();

    click('annotator-toolbar-reading-mode-sepia');

    expect(set).toHaveBeenCalledOnceWith('sepia');
    expect(byTestId('annotator-toolbar-reading-mode-sepia')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(byTestId('annotator-toolbar-reading-mode-normal')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
