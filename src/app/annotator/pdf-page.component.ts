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
import { RenderingCancelledException, TextLayer } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import { Annotation, PdfRect } from './annotation.model';

type Viewport = ReturnType<PDFPageProxy['getViewport']>;
type RenderTask = ReturnType<PDFPageProxy['render']>;

/** Axis-aligned rectangle in page-relative CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One selected text span and the part of it that the selection covers. */
export interface SpanPart {
  span: Element;
  range: Range;
}

/** What a selection covers on one page, in page-relative CSS pixels. */
export interface SelectedText {
  boxes: Box[];
  quote: string;
}

/** A rendered text layer and its pdf.js-style end-of-content marker. */
export interface SelectionMarker {
  layer: HTMLElement;
  end: HTMLElement;
}

interface HighlightBox extends Box {
  id: string;
  color: string;
}

/** One PDF page: canvas, selectable text layer and the highlights drawn on top. */
@Component({
  selector: 'app-pdf-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas class="pdf-page__canvas"></canvas>
    <div class="pdf-page__highlights">
      @for (box of boxes(); track $index) {
        <div
          class="pdf-page__highlight"
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
    '[attr.aria-label]': '"Página " + page().pageNumber',
    '[style.width.px]': 'viewport().width',
    '[style.height.px]': 'viewport().height',
    '[style.--scale-factor]': 'scale()',
  },
})
export class PdfPageComponent {
  readonly page = input.required<PDFPageProxy>();
  readonly scale = input.required<number>();
  readonly annotations = input<Annotation[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly scrollRoot = input<HTMLElement | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly textLayerDiv = viewChild.required<ElementRef<HTMLDivElement>>('textLayer');
  private readonly visible = signal(false);
  private renderTask: RenderTask | null = null;
  private textLayer: TextLayer | null = null;
  private endOfContent: HTMLDivElement | null = null;

  protected readonly viewport = computed(() => this.page().getViewport({ scale: this.scale() }));
  protected readonly boxes = computed<HighlightBox[]>(() => {
    const viewport = this.viewport();
    return this.annotations().flatMap(annotation =>
      annotation.rects.map(rect => ({
        ...toViewportBox(viewport, rect),
        id: annotation.id,
        color: annotation.color,
      })),
    );
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => this.render(this.viewport(), this.visible()));

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
      rects: selected.boxes.map(box => toPdfRect(viewport, box)),
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
    const hits = this.boxes().filter(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
    return hits.at(-1)?.id ?? null;
  }

  /** Vertical offset of the annotation's first line, relative to this page. */
  offsetOf(annotation: Annotation): number {
    const tops = annotation.rects.map(rect => toViewportBox(this.viewport(), rect).top);
    return this.host.offsetTop + Math.min(...tops);
  }

  private async render(viewport: Viewport, visible: boolean): Promise<void> {
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
  private async drawCanvas(viewport: Viewport, canvas: HTMLCanvasElement): Promise<boolean> {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const task = this.page().render({
      canvasContext: canvas.getContext('2d')!,
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

  private async renderTextLayer(viewport: Viewport, container: HTMLDivElement): Promise<void> {
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

function toViewportBox(viewport: Viewport, rect: PdfRect): Box {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

function toPdfRect(viewport: Viewport, box: Box): PdfRect {
  const [ax, ay] = viewport.convertToPdfPoint(box.left, box.top);
  const [bx, by] = viewport.convertToPdfPoint(box.right, box.bottom);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** Joins the per-span rects of a selection into one rect per text line. */
export function mergeLines(boxes: Box[]): Box[] {
  const lines: Box[] = [];
  for (const box of [...boxes].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(l => {
      const overlap = Math.min(l.bottom, box.bottom) - Math.max(l.top, box.top);
      return overlap > 0.5 * Math.min(l.bottom - l.top, box.bottom - box.top);
    });
    if (line) {
      line.left = Math.min(line.left, box.left);
      line.top = Math.min(line.top, box.top);
      line.right = Math.max(line.right, box.right);
      line.bottom = Math.max(line.bottom, box.bottom);
    } else {
      lines.push({ ...box });
    }
  }
  return lines;
}

/**
 * Intersects the selection with the layer's text spans (the clamp): boundaries sitting on a
 * container are resolved to their DOM position and trimmed to the spans of this layer.
 */
export function selectedParts(range: Range, layer: Element): SpanPart[] {
  const parts: SpanPart[] = [];
  for (const span of layer.querySelectorAll('span[role="presentation"]')) {
    if (!range.intersectsNode(span)) continue;
    const part = document.createRange();
    part.selectNodeContents(span);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
      part.setStart(range.startContainer, range.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
      part.setEnd(range.endContainer, range.endOffset);
    }
    // A range ending at offset 0 of the text node is not collapsed but covers nothing
    if (part.toString()) parts.push({ span, range: part });
  }
  return parts;
}

function boxesOf(range: Range, origin: DOMRect): Box[] {
  return [...range.getClientRects()]
    .filter(r => r.width >= 1 && r.height >= 1)
    .map(r => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    }));
}

/** Text of the parts, with one space where a line break separates two spans. */
export function quoteOf(parts: SpanPart[]): string {
  let text = '';
  parts.forEach((part, i) => {
    if (i > 0 && breaksLine(parts[i - 1].span, part.span)) text += ' ';
    text += part.range.toString();
  });
  return text.replace(/\s+/g, ' ').trim();
}

function breaksLine(previous: Element, next: Element): boolean {
  const scope = previous.closest('.textLayer') ?? (previous.getRootNode() as ParentNode);
  return [...scope.querySelectorAll('br')].some(
    br =>
      previous.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_FOLLOWING &&
      next.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_PRECEDING,
  );
}

/** Rects and quote of a selection on one layer, both derived from the same clipped pieces. */
export function selectionInLayer(
  range: Range,
  layer: Element,
  origin: DOMRect,
): SelectedText | null {
  const parts = selectedParts(range, layer);
  const boxes = mergeLines(parts.flatMap(part => boxesOf(part.range, origin)));
  const quote = quoteOf(parts);
  return boxes.length && quote ? { boxes, quote } : null;
}

/** Adds pdf.js' end-of-content marker as the last child; its CSS ships in pdf_viewer.css. */
export function appendEndOfContent(layer: HTMLElement): HTMLDivElement {
  const end = document.createElement('div');
  end.className = 'endOfContent';
  end.setAttribute('aria-hidden', 'true');
  layer.append(end);
  return end;
}
