import {
  appendEndOfContent,
  Box,
  mergeLines,
  quoteOf,
  selectedParts,
  selectionInLayer,
} from './pdf-page.component';
import { br, cleanup, layerOf, range, span } from './testing/dom-builders';

interface BuiltLayer {
  layer: HTMLDivElement;
  end: HTMLDivElement;
  spans: HTMLSpanElement[][];
}

/** One span per [text, left] pair, a br after the last span of each line, then endOfContent. */
function buildLayer(lines: [string, number][][]): BuiltLayer {
  const rows = lines.map((line, row) => line.map(([text, left]) => span(text, row * 30, left)));
  const { layer, end } = layerOf(...rows.flatMap(row => [...row, br()]));
  return { layer, end, spans: rows };
}

afterEach(cleanup);

describe('mergeLines', () => {
  const box = (top: number, left = 0, right = 10, bottom = top + 10): Box => ({
    left,
    top,
    right,
    bottom,
  });

  it('merges boxes that overlap vertically by more than half', () => {
    const merged = mergeLines([box(0, 0, 10, 10), box(2, 20, 30, 12)]);
    expect(merged).toEqual([{ left: 0, top: 0, right: 30, bottom: 12 }]);
  });

  it('keeps different lines apart, sorted top to bottom', () => {
    const merged = mergeLines([box(40), box(0)]);
    expect(merged.map(b => b.top)).toEqual([0, 40]);
  });

  it('does not mutate its input', () => {
    const input = [box(0, 0, 10, 10), box(2, 20, 30, 12)];
    mergeLines(input);
    expect(input).toEqual([box(0, 0, 10, 10), box(2, 20, 30, 12)]);
  });
});

describe('selectedParts', () => {
  it('trims the first and last span to the selection offsets', () => {
    const { layer, spans } = buildLayer([[['alpha one', 0]], [['bravo two', 0]]]);
    const selected = range(spans[0][0].firstChild!, 2, spans[1][0].firstChild!, 5);
    const parts = selectedParts(selected, layer);
    expect(parts.map(p => p.range.toString())).toEqual(['pha one', 'bravo']);
  });

  it('stops at the span before a moved endOfContent', () => {
    const { layer, end, spans } = buildLayer([[['alpha', 0]], [['bravo', 0]], [['charlie', 0]]]);
    spans[1][0].after(end);
    const selected = range(spans[0][0].firstChild!, 1, layer, [...layer.childNodes].indexOf(end));
    expect(selectedParts(selected, layer).map(p => p.span)).toEqual([spans[0][0], spans[1][0]]);
  });

  it('keeps only the start layer when the selection reaches a later layer', () => {
    const first = buildLayer([[['alpha', 0]], [['bravo', 0]]]);
    const second = buildLayer([[['foxtrot', 0]]]);
    const selected = range(first.spans[0][0].firstChild!, 2, second.spans[0][0].firstChild!, 3);
    const parts = selectedParts(selected, first.layer);
    expect(parts.map(p => p.range.toString())).toEqual(['pha', 'bravo']);
  });

  it('skips a span the selection ends at the very start of', () => {
    const { layer, spans } = buildLayer([[['alpha', 0]], [['bravo', 0]]]);
    const selected = range(spans[0][0].firstChild!, 1, spans[1][0].firstChild!, 0);
    expect(selectedParts(selected, layer).map(p => p.span)).toEqual([spans[0][0]]);
  });

  it('never returns br or endOfContent', () => {
    const { layer, spans } = buildLayer([[['alpha', 0]], [['bravo', 0]]]);
    const selected = range(spans[0][0].firstChild!, 0, layer, layer.childNodes.length);
    const parts = selectedParts(selected, layer);
    expect(parts.every(p => p.span.tagName === 'SPAN')).toBeTrue();
  });
});

describe('quoteOf', () => {
  it('joins parts separated by a br with exactly one space', () => {
    const { layer, spans } = buildLayer([[['alpha', 0]], [['bravo', 0]]]);
    const selected = range(layer, 0, layer, layer.childNodes.length);
    expect(quoteOf(selectedParts(selected, layer))).toBe('alpha bravo');
    expect(spans.length).toBe(2);
  });

  it('concatenates parts on the same line without an added space', () => {
    const { layer } = buildLayer([
      [
        ['foo', 0],
        ['bar', 30],
      ],
    ]);
    const selected = range(layer, 0, layer, layer.childNodes.length);
    expect(quoteOf(selectedParts(selected, layer))).toBe('foobar');
  });

  it('collapses whitespace, trims and tolerates no parts', () => {
    const { layer } = buildLayer([[['  a   b  ', 0]]]);
    const selected = range(layer, 0, layer, layer.childNodes.length);
    expect(quoteOf(selectedParts(selected, layer))).toBe('a b');
    expect(quoteOf([])).toBe('');
  });
});

describe('selectionInLayer', () => {
  it('returns one box per line, relative to the origin, and the quote', () => {
    const { layer, spans } = buildLayer([[['alpha', 10]], [['bravo', 10]]]);
    const origin = layer.getBoundingClientRect();
    const selected = range(spans[0][0].firstChild!, 0, spans[1][0].firstChild!, 5);
    const result = selectionInLayer(selected, layer, origin);
    expect(result?.boxes.length).toBe(2);
    expect(result?.boxes[0].left).toBeCloseTo(10, 0);
    expect(result?.boxes[1].top).toBeGreaterThan(result!.boxes[0].top);
    expect(result?.quote).toBe('alpha bravo');
  });

  it('returns null when nothing is selected', () => {
    const { layer, spans } = buildLayer([[['alpha', 0]]]);
    const selected = range(spans[0][0].firstChild!, 2, spans[0][0].firstChild!, 2);
    expect(selectionInLayer(selected, layer, layer.getBoundingClientRect())).toBeNull();
  });

  it('returns null when the selection covers only whitespace', () => {
    const { layer, spans } = buildLayer([[['   ', 0]]]);
    const selected = range(spans[0][0].firstChild!, 0, spans[0][0].firstChild!, 3);
    expect(selectionInLayer(selected, layer, layer.getBoundingClientRect())).toBeNull();
  });
});

describe('appendEndOfContent', () => {
  it('appends an aria-hidden endOfContent div as the last child and returns it', () => {
    const { layer, spans } = buildLayer([[['alpha', 0]]]);
    layer.querySelector('.endOfContent')?.remove();
    const end = appendEndOfContent(layer);
    expect(layer.lastElementChild).toBe(end);
    expect(end.tagName).toBe('DIV');
    expect(end.classList.contains('endOfContent')).toBeTrue();
    expect(end.getAttribute('aria-hidden')).toBe('true');
    expect(spans.length).toBe(1);
  });
});
