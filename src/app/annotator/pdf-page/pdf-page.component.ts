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
  signal,
  viewChild,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { RenderingCancelledException, TextLayer } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type {
  Annotation,
  Box,
  HighlightBox,
  PdfRect,
  PdfRenderTask,
  PdfViewport,
  SelectionMarker,
} from '../../models/annotator.model';
import { LanguageService } from '../../services/layout/language.service';
import { appendEndOfContent, selectionInLayer } from '../text-selection/text-selection';

/** One PDF page: canvas, selectable text layer and the highlights drawn on top. */
@Component({
  selector: 'app-pdf-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas class="pdf-page__canvas"></canvas>
    <div class="pdf-page__highlights">
      @for (box of boxes(); track $index; let i = $index) {
        <div
          class="pdf-page__highlight"
          [attr.data-testid]="'pdf-page-highlight-' + box.id + '-' + i"
          [class.pdf-page__highlight--selected]="box.id === selectedId()"
          [style.left.px]="box.left"
          [style.top.px]="box.top"
          [style.width.px]="box.right - box.left"
          [style.height.px]="box.bottom - box.top"
          [style.background-color]="box.color"
        ></div>
      }
    </div>
    <div #textLayer class="textLayer"></div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      margin: 0 auto 16px;
      background: #fff;
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
      /* Reading mode tint; covers the highlights too so they keep matching the page. */
      filter: var(--page-filter, none);
    }
    .pdf-page__canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .pdf-page__highlights {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .pdf-page__highlight {
      position: absolute;
      mix-blend-mode: multiply;
      opacity: 0.55;
      border-radius: 2px;
    }
    .pdf-page__highlight--selected {
      opacity: 0.85;
      outline: 2px solid rgb(0 0 0 / 0.45);
    }
  `,
  host: {
    role: 'group',
    '[attr.data-testid]': '"pdf-page-" + page().pageNumber',
    '[attr.aria-label]': 'pageLabel()',
    '[style.width.px]': 'viewport().width',
    '[style.height.px]': 'viewport().height',
    '[style.--scale-factor]': 'scale()',
  },
})
export class PdfPageComponent {
  /** The pdf.js page to draw. */
  readonly page = input.required<PDFPageProxy>();
  /** Render scale; the canvas and text layer follow it. */
  readonly scale = input.required<number>();
  /** Annotations of this page, drawn as highlight boxes. */
  readonly annotations = input<Annotation[]>([]);
  /** Id of the selected annotation, drawn emphasised. */
  readonly selectedId = input<string | null>(null);
  /** Scroll container used to render only when near the viewport. */
  readonly scrollRoot = input<HTMLElement | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly textLayerDiv = viewChild.required<ElementRef<HTMLDivElement>>('textLayer');
  private readonly visible = signal(false);
  private renderTask: PdfRenderTask | null = null;
  private textLayer: TextLayer | null = null;
  private endOfContent: HTMLDivElement | null = null;

  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  /** Accessible name of the page. A computed because the host cannot use the translate pipe. */
  protected readonly pageLabel = computed(() => {
    // Read for its dependency only: a language switch must re-run this computed
    this.language.current();
    const label: unknown = this.translate.instant('VIEWER.PAGE_LABEL', {
      page: this.page().pageNumber,
    });
    return typeof label === 'string' ? label : '';
  });
  /** Page viewport at the current scale. */
  protected readonly viewport = computed(() => this.page().getViewport({ scale: this.scale() }));
  /** Highlight boxes in viewport pixels, one per stored rectangle. */
  protected readonly boxes = computed<HighlightBox[]>(() => {
    const viewport = this.viewport();
    return this.annotations().flatMap((annotation) =>
      annotation.rects.map((rect) => ({
        ...toViewportBox(viewport, rect),
        id: annotation.id,
        color: annotation.color,
      })),
    );
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      void this.render(this.viewport(), this.visible());
    });

    afterNextRender(() => {
      const observer = new IntersectionObserver(
        ([entry]) => this.visible.set(entry.isIntersecting),
        { root: this.scrollRoot(), rootMargin: '600px 0px' },
      );
      observer.observe(this.host);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    destroyRef.onDestroy(() => this.cancelRender());
  }

  /** Whether a DOM node belongs to this page; used to attribute a selection to a page. */
  contains(node: Node): boolean {
    return this.host.contains(node);
  }

  /**
   * Turns a DOM text selection on this page into highlight rects in PDF space. The selection is
   * clamped to this page's text spans, so rects and quote never leak into other pages.
   */
  captureSelection(range: Range): { page: number; rects: PdfRect[]; quote: string } | null {
    const origin = this.host.getBoundingClientRect();
    const selected = selectionInLayer(range, this.textLayerDiv().nativeElement, origin);
    if (!selected) return null;
    const viewport = this.viewport();
    return {
      page: this.page().pageNumber,
      rects: selected.boxes.map((box) => toPdfRect(viewport, box)),
      quote: selected.quote,
    };
  }

  /** The text layer and its end-of-content marker, or null while the layer is not rendered. */
  selectionMarker(): SelectionMarker | null {
    if (!this.endOfContent) return null;
    return { layer: this.textLayerDiv().nativeElement, end: this.endOfContent };
  }

  /** Returns the id of the highlight under the given screen point, if any. */
  hitTest(clientX: number, clientY: number): string | null {
    const origin = this.host.getBoundingClientRect();
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    const hits = this.boxes().filter(
      (b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom,
    );
    return hits.at(-1)?.id ?? null;
  }

  /** Vertical offset of the annotation's first line, relative to this page. */
  offsetOf(annotation: Annotation): number {
    const tops = annotation.rects.map((rect) => toViewportBox(this.viewport(), rect).top);
    return this.host.offsetTop + Math.min(...tops);
  }

  private async render(viewport: PdfViewport, visible: boolean): Promise<void> {
    this.cancelRender();
    const canvas = this.canvas().nativeElement;
    const textDiv = this.textLayerDiv().nativeElement;
    textDiv.replaceChildren();
    this.endOfContent = null;
    if (!visible) {
      canvas.width = canvas.height = 0;
      return;
    }
    if (await this.drawCanvas(viewport, canvas)) await this.renderTextLayer(viewport, textDiv);
  }

  /** Returns false when the render was cancelled or superseded by a newer one. */
  private async drawCanvas(viewport: PdfViewport, canvas: HTMLCanvasElement): Promise<boolean> {
    const context = canvas.getContext('2d');
    if (!context) return false;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const task = this.page().render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (error) {
      if (error instanceof RenderingCancelledException) return false;
      throw error;
    }
    return this.renderTask === task;
  }

  private async renderTextLayer(viewport: PdfViewport, container: HTMLDivElement): Promise<void> {
    const textLayer = new TextLayer({
      textContentSource: this.page().streamTextContent(),
      container,
      viewport,
    });
    this.textLayer = textLayer;
    await textLayer.render();
    // A newer render or a cancel happened meanwhile: this layer is gone, so it gets no marker.
    if (this.textLayer !== textLayer) return;
    this.endOfContent = appendEndOfContent(container);
  }

  private cancelRender(): void {
    this.renderTask?.cancel();
    this.renderTask = null;
    this.textLayer?.cancel();
    this.textLayer = null;
  }
}

/** Converts a PDF-space rectangle to a normalised viewport box. */
function toViewportBox(viewport: PdfViewport, rect: PdfRect): Box {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect) as number[];
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

/** Converts a viewport box back to a normalised PDF-space rectangle. */
function toPdfRect(viewport: PdfViewport, box: Box): PdfRect {
  const [ax, ay] = viewport.convertToPdfPoint(box.left, box.top) as number[];
  const [bx, by] = viewport.convertToPdfPoint(box.right, box.bottom) as number[];
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
