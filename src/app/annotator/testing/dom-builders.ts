/** A synthetic text layer, as pdf.js renders it, plus its trailing `endOfContent` marker. */
export interface BuiltLayer {
  layer: HTMLDivElement;
  end: HTMLDivElement;
  spans: HTMLSpanElement[];
}

const created: HTMLElement[] = [];

/** Registers an element appended to the document so `cleanup()` removes it. */
export function track<T extends HTMLElement>(element: T): T {
  created.push(element);
  return element;
}

/** Removes everything the builders appended and clears the document selection. Call from `afterEach`. */
export function cleanup(): void {
  created.splice(0).forEach(element => element.remove());
  document.getSelection()?.removeAllRanges();
}

/** An absolutely positioned `span[role="presentation"]`, like a pdf.js text run. */
export function span(text: string, top = 0, left = 0): HTMLSpanElement {
  const element = document.createElement('span');
  element.setAttribute('role', 'presentation');
  element.style.cssText = `position:absolute;font-size:10px;left:${left}px;top:${top}px`;
  element.textContent = text;
  return element;
}

/** The `br[role="presentation"]` pdf.js emits after the last span of a line. */
export function br(): HTMLBRElement {
  const element = document.createElement('br');
  element.setAttribute('role', 'presentation');
  return element;
}

/** A 300x200 `.textLayer` holding `children` and a trailing `endOfContent`, appended to the body. */
export function layerOf(...children: Node[]): BuiltLayer {
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  layer.style.cssText = 'position:relative;width:300px;height:200px';
  layer.append(...children);
  const end = document.createElement('div');
  end.className = 'endOfContent';
  layer.append(end);
  document.body.append(layer);
  track(layer);
  const spans = [...layer.querySelectorAll<HTMLSpanElement>('span[role="presentation"]')];
  return { layer, end, spans };
}

/** Builds a `Range` between two boundary points. */
export function range(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): Range {
  const result = document.createRange();
  result.setStart(startNode, startOffset);
  result.setEnd(endNode, endOffset);
  return result;
}
