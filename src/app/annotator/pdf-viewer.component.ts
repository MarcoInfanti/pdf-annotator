import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Annotation, TextSelection } from './annotation.model';
import type { SelectionMarker } from './pdf-page.component';
import { PdfPageComponent } from './pdf-page.component';

GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';

/** Scrollable list of pages. Reports text selections and clicks on highlights. */
@Component({
  selector: 'app-pdf-viewer',
  imports: [PdfPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as message) {
      <p class="pdf-viewer__status" role="alert">{{ message }}</p>
    } @else if (!pages().length) {
      <p class="pdf-viewer__status">Cargando PDF…</p>
    }
    @for (page of pages(); track page) {
      <app-pdf-page
        [page]="page"
        [scale]="scale()"
        [scrollRoot]="host"
        [annotations]="annotationsByPage().get(page.pageNumber) ?? []"
        [selectedId]="selectedId()"
      />
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: auto;
      padding: 16px;
      background: var(--viewer-bg);
    }
    .pdf-viewer__status {
      text-align: center;
      color: var(--text-muted);
    }
  `,
  host: {
    '(mousedown)': 'startSelection($event)',
    '(wheel)': 'zoomWithWheel($event)',
    '(document:mouseup)': 'finishSelection($event)',
  },
})
export class PdfViewerComponent {
  readonly data = input.required<Uint8Array>();
  readonly scale = input(1.25);
  readonly annotations = input<Annotation[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly textSelected = output<TextSelection>();
  readonly annotationClicked = output<string | null>();
  /** Ctrl + mouse wheel: 1 zooms in, -1 zooms out. */
  readonly zoomRequested = output<1 | -1>();

  protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly pageComponents = viewChildren(PdfPageComponent);
  private pdf: PDFDocumentProxy | null = null;
  private pressedTextLayer: Element | null = null;
  private previousScale: number | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private pointerDown = false;
  private previousRange: Range | null = null;
  private mozSelection: boolean | null = null;

  protected readonly pages = signal<PDFPageProxy[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly annotationsByPage = computed(() => {
    const byPage = new Map<number, Annotation[]>();
    for (const annotation of this.annotations()) {
      byPage.set(annotation.page, [...(byPage.get(annotation.page) ?? []), annotation]);
    }
    return byPage;
  });

  constructor() {
    effect(() => {
      void this.loadDocument(this.data());
    });
    effect(() => this.keepCenterOnZoom(this.scale()));
    this.destroyRef.onDestroy(() => {
      void this.pdf?.destroy();
    });
    afterNextRender(() => this.listenToSelection());
  }

  /** Scale at which the first page fills the available width. */
  fitWidthScale(): number | null {
    const page = this.pages().at(0);
    if (!page) return null;
    const padding = 32;
    const available = this.host.clientWidth - padding;
    return available / page.getViewport({ scale: 1 }).width;
  }

  scrollTo(annotation: Annotation): void {
    const page = annotation.page > 0 ? this.pageComponents().at(annotation.page - 1) : undefined;
    if (page) {
      this.host.scrollTo({ top: page.offsetOf(annotation) - 80, behavior: 'smooth' });
    }
  }

  protected zoomWithWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomRequested.emit(event.deltaY < 0 ? 1 : -1);
  }

  /** Keeps the same spot of the document in the middle of the screen when the scale changes. */
  private keepCenterOnZoom(scale: number): void {
    const previous = this.previousScale;
    this.previousScale = scale;
    if (previous === null || previous === scale) return;
    const ratio = scale / previous;
    const { scrollTop, scrollLeft, clientHeight, clientWidth } = this.host;
    requestAnimationFrame(() => {
      this.host.scrollTop = (scrollTop + clientHeight / 2) * ratio - clientHeight / 2;
      this.host.scrollLeft = (scrollLeft + clientWidth / 2) * ratio - clientWidth / 2;
    });
  }

  protected startSelection(event: MouseEvent): void {
    const textLayer = (event.target as Element).closest('.textLayer');
    // pdf.js' CSS stretches the layer's endOfContent over the page while selecting, so drags over
    // gaps don't jump to the container.
    textLayer?.classList.add('selecting');
    this.pressedTextLayer = textLayer;
  }

  protected finishSelection(event: MouseEvent): void {
    if (!this.pressedTextLayer) return;
    this.pressedTextLayer.classList.remove('selecting');
    this.pressedTextLayer = null;

    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) {
      this.captureFrom(selection, event);
      return;
    }
    const page = this.pageComponents().find((p) => p.contains(event.target as Node));
    this.annotationClicked.emit(page?.hitTest(event.clientX, event.clientY) ?? null);
  }

  /** Emits the selection as a `TextSelection` of the page where the user pressed, if it has text. */
  private captureFrom(selection: Selection, event: MouseEvent): void {
    const range = selection.getRangeAt(0);
    // The pressed page (the selection's anchor) wins over DOM order, so a backward drag keeps
    // the part on the page where it started
    const anchor = selection.anchorNode ?? range.startContainer;
    const page = this.pageComponents().find((p) => p.contains(anchor));
    const captured = page?.captureSelection(range);
    if (captured) {
      this.textSelected.emit({ ...captured, clientX: event.clientX, clientY: event.clientY });
    }
  }

  /**
   * Raw document listeners, like pdf.js' text layer builder: `selectionchange` fires on every caret
   * move, and they only touch DOM classes and styles, never signals, so no change detection runs.
   */
  private listenToSelection(): void {
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener('pointerdown', () => (this.pointerDown = true), { signal });
    document.addEventListener('pointerup', () => this.releasePointer(), { signal });
    window.addEventListener('blur', () => this.releasePointer(), { signal });
    document.addEventListener('keyup', () => this.resetAfterKey(), { signal });
    document.addEventListener('selectionchange', () => this.followSelection(), { signal });
    this.destroyRef.onDestroy(() => controller.abort());
  }

  /** Markers of the pages that are currently rendered. */
  private selectionMarkers(): SelectionMarker[] {
    return this.pageComponents().flatMap((page) => page.selectionMarker() ?? []);
  }

  private releasePointer(): void {
    this.pointerDown = false;
    this.selectionMarkers().forEach(resetMarker);
  }

  private resetAfterKey(): void {
    if (!this.pointerDown) this.selectionMarkers().forEach(resetMarker);
  }

  private followSelection(): void {
    const markers = this.selectionMarkers();
    if (!markers.length) return;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      markers.forEach(resetMarker);
      return;
    }
    markSelectingLayers(selection, markers);
    this.mozSelection ??= usesMozUserSelect(markers[0]);
    if (this.mozSelection) return;
    const range = selection.getRangeAt(0);
    moveEndOfContent(range, this.previousRange, markers);
    this.previousRange = range.cloneRange();
  }

  private async loadDocument(data: Uint8Array): Promise<void> {
    const previous = this.pdf;
    this.pdf = null;
    this.pages.set([]);
    this.error.set(null);
    await previous?.destroy();
    try {
      // pdf.js transfers the buffer to its worker, so it gets a copy.
      const pdf = await getDocument({ data: data.slice() }).promise;
      this.pdf = pdf;
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)),
      );
      if (this.pdf === pdf) this.pages.set(pages);
    } catch (error) {
      console.error(error);
      this.error.set('No se ha podido abrir el PDF.');
    }
  }
}

/** Puts the marker back as the last child of its layer and drops the selecting state. */
export function resetMarker({ layer, end }: SelectionMarker): void {
  layer.append(end);
  end.style.width = '';
  end.style.height = '';
  layer.classList.remove('selecting');
}

/** Flags the layers the selection touches as selecting and resets every other one. */
export function markSelectingLayers(selection: Selection, markers: SelectionMarker[]): void {
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i));
  for (const marker of markers) {
    if (ranges.some((range) => range.intersectsNode(marker.layer))) {
      marker.layer.classList.add('selecting');
    } else {
      resetMarker(marker);
    }
  }
}

/** pdf.js' Firefox detection: there the `selecting` stretch alone is enough. */
export function usesMozUserSelect(marker: SelectionMarker): boolean {
  return getComputedStyle(marker.end).getPropertyValue('-moz-user-select') === 'none';
}

/** Moves the marker next to the moving end of the selection, as pdf.js' text layer builder does. */
export function moveEndOfContent(
  range: Range,
  previous: Range | null,
  markers: SelectionMarker[],
): void {
  const modifyStart =
    !!previous &&
    (range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, previous) === 0);
  let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  const layer = anchor?.parentElement?.closest('.textLayer');
  const marker = markers.find((m) => m.layer === layer);
  if (!anchor || !marker || !anchor.parentElement) return;
  marker.end.style.width = marker.layer.style.width;
  marker.end.style.height = marker.layer.style.height;
  anchor.parentElement.insertBefore(marker.end, modifyStart ? anchor : anchor.nextSibling);
}
