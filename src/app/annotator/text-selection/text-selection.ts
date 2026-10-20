import type { Box, SelectedText, SpanPart } from '../../models/annotator.model';

/** Joins the per-span rects of a selection into one rect per text line. */
export function mergeLines(boxes: Box[]): Box[] {
  const lines: Box[] = [];
  for (const box of [...boxes].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((l) => {
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
    .filter((r) => r.width >= 1 && r.height >= 1)
    .map((r) => ({
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
    (br) =>
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
  const boxes = mergeLines(parts.flatMap((part) => boxesOf(part.range, origin)));
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
