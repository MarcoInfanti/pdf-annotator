import {
  forwardRef,
  provideZonelessChangeDetection,
  Component,
  input,
  output,
} from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import type { Annotation, TextSelection, ViewerPosition } from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AutosaveSignals } from '../../signals/annotator/autosave.signals';
import { AnnotatorToolbarComponent } from '../annotator-toolbar/annotator-toolbar.component';
import { PdfViewerComponent } from '../pdf-viewer/pdf-viewer.component';
import { AnnotatorComponent } from './annotator.component';

/** Stands in for the real viewer: pdf.js does not run in Karma. */
@Component({
  selector: 'app-pdf-viewer',
  template: '',
  providers: [{ provide: PdfViewerComponent, useExisting: forwardRef(() => ViewerStub) }],
})
class ViewerStub {
  readonly data = input.required<Uint8Array>();
  readonly scale = input(1.25);
  readonly annotations = input<Annotation[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly textSelected = output<TextSelection>();
  readonly annotationClicked = output<string | null>();
  readonly zoomRequested = output<1 | -1>();
  readonly positionChanged = output<ViewerPosition>();
  readonly documentStartMeasured = output<ViewerPosition>();
  readonly fitWidthScale = (): number => 1;
  readonly scrollTo = (): void => {};
  readonly jumpTo = (): boolean => true;
}

describe('AnnotatorSignals scoping', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnnotatorComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: FileAccessService, useValue: { pickPdf: () => Promise.resolve(null) } },
        { provide: PdfAnnotationCodecService, useValue: {} },
      ],
    }).overrideComponent(AnnotatorComponent, {
      remove: { imports: [PdfViewerComponent] },
      add: { imports: [ViewerStub] },
    });
  });

  afterEach(() => {
    localStorage.removeItem('pdf-annotations.reading-mode');
    localStorage.removeItem('pdf-annotations.sidebar-width');
    document.documentElement.removeAttribute('data-theme');
  });

  function create(): ComponentFixture<AnnotatorComponent> {
    const fixture = TestBed.createComponent(AnnotatorComponent);
    fixture.detectChanges();
    return fixture;
  }

  function storeOf(fixture: ComponentFixture<AnnotatorComponent>): AnnotatorSignals {
    return fixture.debugElement.injector.get(AnnotatorSignals);
  }

  it('is not available from the root injector', () => {
    expect(() => TestBed.inject(AnnotatorSignals)).toThrowError(/NullInjectorError|No provider/);
  });

  it('is not available to a toolbar created outside the page', () => {
    expect(() => TestBed.createComponent(AnnotatorToolbarComponent)).toThrowError(
      /NullInjectorError|No provider/,
    );
  });

  it('gives each page its own store instance', () => {
    const first = create();
    const second = create();

    expect(storeOf(first)).not.toBe(storeOf(second));
  });

  it('does not leak state between two pages alive at once', () => {
    const first = create();
    const second = create();

    storeOf(first).setZoom(2);
    storeOf(first).setSearch('needle');
    storeOf(first).select('abc');

    expect(storeOf(second).scale()).toBe(1.25);
    expect(storeOf(second).search()).toBe('');
    expect(storeOf(second).selectedId()).toBeNull();
  });

  it('starts from a clean store when the page is destroyed and created again', () => {
    const first = create();
    storeOf(first).setZoom(3);
    storeOf(first).setSearch('needle');
    storeOf(first).startEditing('abc');
    first.destroy();

    const second = create();

    expect(storeOf(second).scale()).toBe(1.25);
    expect(storeOf(second).search()).toBe('');
    expect(storeOf(second).editingId()).toBeNull();
    expect(storeOf(second).dirty()).toBeFalse();
    expect(storeOf(second).notice()).toBeNull();
  });

  it('shares one store between the page and its toolbar child', () => {
    const fixture = create();
    const toolbar = fixture.debugElement.children.find(
      (child) => child.componentInstance instanceof AnnotatorToolbarComponent,
    );

    expect(toolbar?.injector.get(AnnotatorSignals)).toBe(storeOf(fixture));
  });

  it('keeps the save store out of the root injector too', () => {
    expect(() => TestBed.inject(AutosaveSignals)).toThrowError(/NullInjectorError|No provider/);
  });

  it('gives each page its own save store, shared with its toolbar child', () => {
    const first = create();
    const second = create();
    const saveStoreOf = (fixture: ComponentFixture<AnnotatorComponent>): AutosaveSignals =>
      fixture.debugElement.injector.get(AutosaveSignals);
    const toolbar = first.debugElement.children.find(
      (child) => child.componentInstance instanceof AnnotatorToolbarComponent,
    );

    expect(saveStoreOf(first)).not.toBe(saveStoreOf(second));
    expect(toolbar?.injector.get(AutosaveSignals)).toBe(saveStoreOf(first));
  });
});
