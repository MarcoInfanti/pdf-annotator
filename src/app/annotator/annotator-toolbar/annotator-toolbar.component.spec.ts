import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import type { DecodedPdf, PickedFile } from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { READING_MODES, ReadingModeService } from '../../services/layout/reading-mode.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AutosaveSignals } from '../../signals/annotator/autosave.signals';
import { missingTranslationKeys } from '../testing/translation-keys/translation-keys';
import { AnnotatorToolbarComponent } from './annotator-toolbar.component';

const BYTES = new Uint8Array([1, 2, 3]);

describe('AnnotatorToolbarComponent', () => {
  let fixture: ComponentFixture<AnnotatorToolbarComponent>;
  let store: AnnotatorSignals;
  let autosave: AutosaveSignals;
  let activation: jasmine.Spy<() => UserActivation>;
  let files: {
    [
      K in
        | 'pickPdf'
        | 'download'
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

  async function flushPromises(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  function click(id: string): void {
    byTestId(id)?.click();
    fixture.detectChanges();
  }

  async function openDocument(
    encrypted = false,
    withHandle = false,
    writeGranted = true,
  ): Promise<void> {
    const picked: PickedFile = {
      name: 'book.pdf',
      bytes: BYTES,
      handle: withHandle ? ({} as FileSystemFileHandle) : null,
      stamp: { size: 3, lastModified: 1 },
      writeGranted: withHandle && writeGranted,
    };
    const decoded: DecodedPdf = {
      cleanBytes: BYTES,
      annotations: [],
      encrypted,
      pageCount: 1,
      position: null,
    };
    files.pickPdf.and.resolveTo(picked);
    codec.decode.and.resolveTo(decoded);
    await store.open();
    fixture.detectChanges();
  }

  beforeEach(() => {
    files = {
      pickPdf: jasmine.createSpy<FileAccessService['pickPdf']>('pickPdf'),
      download: jasmine.createSpy<FileAccessService['download']>('download'),
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
      imports: [AnnotatorToolbarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        AnnotatorSignals,
        AutosaveSignals,
        { provide: FileAccessService, useValue: files },
        { provide: PdfAnnotationCodecService, useValue: codec },
      ],
    });
    // Karma clicks carry no user activation; the import tests set the answer they need
    activation = spyOnProperty(navigator, 'userActivation', 'get').and.returnValue({
      isActive: true,
    } as UserActivation);
    store = TestBed.inject(AnnotatorSignals);
    autosave = TestBed.inject(AutosaveSignals);
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

  it('renders the language switcher with and without a document', async () => {
    expect(byTestId('language-switcher')).not.toBeNull();

    await openDocument();

    expect(byTestId('language-switcher')).not.toBeNull();
  });

  it('emits openRequested when the open button is clicked', () => {
    const emitted = jasmine.createSpy('openRequested');
    fixture.componentInstance.openRequested.subscribe(emitted);

    click('annotator-toolbar-open');

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('calls the store from save, save-copy, export and import', async () => {
    await openDocument();
    const save = spyOn(autosave, 'save').and.resolveTo();
    const saveCopy = spyOn(store, 'saveCopy').and.resolveTo();
    const exportJson = spyOn(store, 'exportJson');
    const importJson = spyOn(store, 'importJson').and.resolveTo();

    click('annotator-toolbar-save');
    click('annotator-toolbar-save-copy');
    click('annotator-toolbar-export-json');
    click('annotator-toolbar-import-json');
    await flushPromises();

    expect(save).toHaveBeenCalledTimes(1);
    expect(saveCopy).toHaveBeenCalledTimes(1);
    expect(exportJson).toHaveBeenCalledTimes(1);
    expect(importJson).toHaveBeenCalledTimes(1);
  });

  describe('import after asking for write access', () => {
    async function clickImport(): Promise<void> {
      click('annotator-toolbar-import-json');
      await flushPromises();
    }

    it('opens the chooser while the click still counts as a user activation', async () => {
      await openDocument();
      activation.and.returnValue({ isActive: true } as UserActivation);
      const importJson = spyOn(store, 'importJson').and.resolveTo();

      await clickImport();

      expect(importJson).toHaveBeenCalledTimes(1);
    });

    it('opens the chooser where the activation API does not exist', async () => {
      await openDocument();
      activation.and.returnValue(undefined as unknown as UserActivation);
      const importJson = spyOn(store, 'importJson').and.resolveTo();

      await clickImport();

      expect(importJson).toHaveBeenCalledTimes(1);
    });

    it('does not open the chooser once the activation expired, and says to press again', async () => {
      await openDocument();
      activation.and.returnValue({ isActive: false } as UserActivation);
      const importJson = spyOn(store, 'importJson').and.resolveTo();

      await clickImport();

      expect(importJson).not.toHaveBeenCalled();
      expect(store.notice()).toEqual({ key: 'NOTICE.IMPORT_RETRY' });
      expect(store.busy()).toBeFalse();
    });
  });

  it('asks for write access on the import click, and only then opens the chooser', async () => {
    await openDocument(false, true);
    const order: string[] = [];
    spyOn(autosave, 'requestWriteAccess').and.callFake(async () => {
      order.push('request');
      await Promise.resolve();
      order.push('requested');
    });
    spyOn(store, 'importJson').and.callFake(() => {
      order.push('chooser');
      return Promise.resolve();
    });

    click('annotator-toolbar-import-json');
    expect(order).toEqual(['request']);
    await flushPromises();

    expect(order).toEqual(['request', 'requested', 'chooser']);
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

  it('translates the save button title instead of showing the raw key', async () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { TOOLBAR: { SAVE_TITLE_DOWNLOAD: 'Download the PDF' } });
    translate.use('en');
    await openDocument();

    expect(byTestId('annotator-toolbar-save')?.getAttribute('title')).toBe('Download the PDF');
  });

  it('only uses translation keys that exist in both bundles', () => {
    const keys = [
      'TOOLBAR.OPEN',
      'TOOLBAR.SAVE',
      'TOOLBAR.SAVE_TITLE_OVERWRITE',
      'TOOLBAR.SAVE_TITLE_DOWNLOAD',
      'TOOLBAR.SAVE_COPY',
      'TOOLBAR.EXPORT_JSON',
      'TOOLBAR.IMPORT_JSON',
      'TOOLBAR.UNSAVED',
      'TOOLBAR.UNSAVED_TITLE',
      'TOOLBAR.SAVING',
      'TOOLBAR.SAVED',
      'TOOLBAR.SAVED_TITLE',
      'TOOLBAR.AUTOSAVE',
      'TOOLBAR.AUTOSAVE_TITLE_ON',
      'TOOLBAR.AUTOSAVE_TITLE_OFF',
      'TOOLBAR.AUTOSAVE_UNAVAILABLE',
      'TOOLBAR.AUTOSAVE_PAUSED',
      'TOOLBAR.AUTOSAVE_PAUSED_TITLE',
      'NOTICE.IMPORT_RETRY',
      'TOOLBAR.READING_MODE',
      'TOOLBAR.READING_MODE_TITLE',
      'TOOLBAR.ZOOM',
      'TOOLBAR.ZOOM_OUT',
      'TOOLBAR.ZOOM_OUT_TITLE',
      'TOOLBAR.ZOOM_IN',
      'TOOLBAR.ZOOM_IN_TITLE',
      'TOOLBAR.ZOOM_LEVEL',
      'TOOLBAR.FIT_WIDTH',
      'TOOLBAR.FIT_WIDTH_SHORT',
    ].concat(READING_MODES.map((mode) => mode.labelKey));

    expect(missingTranslationKeys(keys)).toEqual([]);
  });

  describe('save status', () => {
    const STATUS_IDS = [
      'annotator-toolbar-dirty',
      'annotator-toolbar-saving',
      'annotator-toolbar-saved',
      'annotator-toolbar-autosave-paused',
    ];

    /** The status testids currently rendered inside the status region. */
    function rendered(): string[] {
      return STATUS_IDS.filter((id) => byTestId(id) !== null);
    }

    function change(): void {
      store.add({ page: 1, rects: [[0, 0, 1, 1]], quote: 'q', clientX: 0, clientY: 0 });
      TestBed.tick();
      fixture.detectChanges();
    }

    it('keeps an always-mounted polite live region', async () => {
      await openDocument();

      const region = byTestId('annotator-toolbar-save-status');
      expect(region?.getAttribute('role')).toBe('status');
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(rendered()).toEqual([]);
    });

    it('shows only the unsaved marker while there are unsaved changes', async () => {
      await openDocument();

      change();

      expect(rendered()).toEqual(['annotator-toolbar-dirty']);
    });

    it('shows only the saved marker after a save', async () => {
      await openDocument();
      change();

      await autosave.save();
      fixture.detectChanges();

      expect(rendered()).toEqual(['annotator-toolbar-saved']);
    });

    it('shows only the saving marker while a write is running', async () => {
      await openDocument(false, true);
      change();
      let finish!: () => void;
      files.overwrite.and.returnValue(new Promise<void>((resolve) => (finish = resolve)));

      const saving = autosave.save();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(rendered()).toEqual(['annotator-toolbar-saving']);
      finish();
      await saving;
    });

    it('shows nothing after opening without write permission, until the prompt is denied', async () => {
      await openDocument(false, true, false);
      fixture.detectChanges();
      expect(rendered()).toEqual([]);

      files.requestWritePermission.and.resolveTo(false);
      change();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      TestBed.tick();
      fixture.detectChanges();

      expect(rendered()).toEqual(['annotator-toolbar-autosave-paused']);
    });
  });

  describe('autosave toggle', () => {
    afterEach(() => localStorage.removeItem('pdf-annotations.autosave'));

    it('reflects the setting in aria-pressed and flips and persists it on click', async () => {
      await openDocument(false, true);
      const toggle = (): HTMLElement | null => byTestId('annotator-toolbar-autosave');
      expect(toggle()?.getAttribute('aria-pressed')).toBe('true');

      click('annotator-toolbar-autosave');
      expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
      expect(localStorage.getItem('pdf-annotations.autosave')).toBe('false');

      click('annotator-toolbar-autosave');
      expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
      expect(localStorage.getItem('pdf-annotations.autosave')).toBe('true');
    });

    it('sits right after the download-copy button', async () => {
      await openDocument(false, true);

      const copy = byTestId('annotator-toolbar-save-copy');
      expect(copy?.nextElementSibling).toBe(byTestId('annotator-toolbar-autosave'));
    });

    it('sits right after save when the copy button is hidden for an encrypted PDF', async () => {
      await openDocument(true, true);

      const save = byTestId('annotator-toolbar-save');
      expect(save?.nextElementSibling).toBe(byTestId('annotator-toolbar-autosave'));
    });

    it('is disabled for a file without a handle', async () => {
      await openDocument();

      const toggle = byTestId('annotator-toolbar-autosave') as HTMLButtonElement;
      expect(toggle.disabled).toBeTrue();
      expect(toggle.getAttribute('title')).toBe('TOOLBAR.AUTOSAVE_UNAVAILABLE');
    });

    it('is disabled for an encrypted PDF even with a handle', async () => {
      await openDocument(true, true);

      const toggle = byTestId('annotator-toolbar-autosave') as HTMLButtonElement;
      expect(toggle.disabled).toBeTrue();
      expect(toggle.getAttribute('title')).toBe('TOOLBAR.AUTOSAVE_UNAVAILABLE');
    });

    it('titles the toggle for its current state', async () => {
      await openDocument(false, true);
      const title = (): string | null =>
        byTestId('annotator-toolbar-autosave')?.getAttribute('title') ?? null;
      expect(title()).toBe('TOOLBAR.AUTOSAVE_TITLE_ON');

      click('annotator-toolbar-autosave');

      expect(title()).toBe('TOOLBAR.AUTOSAVE_TITLE_OFF');
    });
  });

  describe('busy', () => {
    it('disables open, save and download copy while either store is busy', async () => {
      await openDocument(false, true);
      const ids = [
        'annotator-toolbar-open',
        'annotator-toolbar-save',
        'annotator-toolbar-save-copy',
      ];
      const disabled = (): boolean[] =>
        ids.map((id) => (byTestId(id) as HTMLButtonElement).disabled);
      expect(disabled()).toEqual([false, false, false]);

      let finish!: () => void;
      files.overwrite.and.returnValue(new Promise<void>((resolve) => (finish = resolve)));
      const saving = autosave.save();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(disabled()).toEqual([true, true, true]);
      finish();
      await saving;
      fixture.detectChanges();
      expect(disabled()).toEqual([false, false, false]);
    });
    it('also disables them while the feature store is busy', async () => {
      await openDocument(false, true);
      files.pickPdf.and.returnValue(new Promise(() => undefined));

      void store.open();
      fixture.detectChanges();

      const open = byTestId('annotator-toolbar-open') as HTMLButtonElement;
      const save = byTestId('annotator-toolbar-save') as HTMLButtonElement;
      expect([open.disabled, save.disabled]).toEqual([true, true]);
    });
  });
});
