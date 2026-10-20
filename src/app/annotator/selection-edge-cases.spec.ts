import { quoteOf, selectedParts, selectionInLayer } from './pdf-page.component';
import { markSelectingLayers, moveEndOfContent, resetMarker } from './pdf-viewer.component';
import { br, cleanup, layerOf, range, span, track } from './testing/dom-builders';

afterEach(cleanup);

describe('selectedParts (adversarial)', () => {
  it('returns nothing for a range entirely outside the layer', () => {
    const { layer } = layerOf(span('alpha'));
    const other = document.createElement('p');
    other.textContent = 'elsewhere';
    document.body.append(other);
    track(other);
    expect(selectedParts(range(other.firstChild!, 0, other.firstChild!, 5), layer)).toEqual([]);
  });

  it('returns nothing for a collapsed range on the layer itself', () => {
    const { layer } = layerOf(span('alpha'), br(), span('bravo'));
    expect(selectedParts(range(layer, 1, layer, 1), layer)).toEqual([]);
  });

  it('returns nothing for a range that sits only on endOfContent', () => {
    const { layer, end } = layerOf(span('alpha'));
    expect(selectedParts(range(end, 0, end, 0), layer)).toEqual([]);
    expect(
      selectedParts(
        range(layer, layer.childNodes.length - 1, layer, layer.childNodes.length),
        layer,
      ),
    ).toEqual([]);
  });

  it('ignores empty spans', () => {
    const { layer } = layerOf(span('alpha'), span(''), span('bravo', 0, 50));
    const parts = selectedParts(range(layer, 0, layer, layer.childNodes.length), layer);
    expect(parts.map((p) => p.range.toString())).toEqual(['alpha', 'bravo']);
  });

  it('excludes the span a selection starts at the very end of', () => {
    const { layer, spans } = layerOf(span('alpha'), br(), span('bravo', 30));
    const parts = selectedParts(range(spans[0].firstChild!, 5, spans[1].firstChild!, 3), layer);
    expect(parts.map((p) => p.range.toString())).toEqual(['bra']);
  });

  it('selects whole text when boundaries are at offset 0 and text length', () => {
    const { layer, spans } = layerOf(span('alpha'), br(), span('bravo', 30));
    const parts = selectedParts(range(spans[0].firstChild!, 0, spans[1].firstChild!, 5), layer);
    expect(parts.map((p) => p.range.toString())).toEqual(['alpha', 'bravo']);
  });

  it('finds spans nested in markedContent wrappers', () => {
    const wrapper = document.createElement('span');
    wrapper.className = 'markedContent';
    wrapper.append(span('alpha'), span('beta', 0, 40));
    const { layer } = layerOf(wrapper);
    const parts = selectedParts(range(layer, 0, layer, layer.childNodes.length), layer);
    expect(parts.map((p) => p.range.toString())).toEqual(['alpha', 'beta']);
  });

  it('works for a backward-built range (selection focus before anchor, normalised by the DOM)', () => {
    const { layer, spans } = layerOf(span('alpha'), br(), span('bravo', 30));
    const sel = document.getSelection()!;
    sel.collapse(spans[1].firstChild, 3);
    sel.extend(spans[0].firstChild!, 2);
    const parts = selectedParts(sel.getRangeAt(0), layer);
    expect(parts.map((p) => p.range.toString())).toEqual(['pha', 'bra']);
  });
});

describe('quoteOf (adversarial)', () => {
  it('separates lines with one space even when each line is in its own markedContent wrapper', () => {
    const w1 = document.createElement('span');
    w1.className = 'markedContent';
    w1.append(span('alpha'), br());
    const w2 = document.createElement('span');
    w2.className = 'markedContent';
    w2.append(span('bravo', 30));
    const { layer } = layerOf(w1, w2);
    const parts = selectedParts(range(layer, 0, layer, layer.childNodes.length), layer);
    expect(quoteOf(parts)).toBe('alpha bravo');
  });

  it('separates lines when the br is the last child of a wrapper that holds the previous span', () => {
    const w1 = document.createElement('span');
    w1.className = 'markedContent';
    w1.append(span('alpha'), br());
    const { layer } = layerOf(w1, span('bravo', 30));
    const parts = selectedParts(range(layer, 0, layer, layer.childNodes.length), layer);
    expect(quoteOf(parts)).toBe('alpha bravo');
  });

  // SOURCE BUG (low likelihood): breaksLine only walks siblings of the span. Enable once fixed.
  it('separates lines when the br sits between two markedContent wrappers', () => {
    const w1 = document.createElement('span');
    w1.className = 'markedContent';
    w1.append(span('alpha'));
    const w2 = document.createElement('span');
    w2.className = 'markedContent';
    w2.append(span('bravo', 30));
    const { layer } = layerOf(w1, br(), w2);
    const parts = selectedParts(range(layer, 0, layer, layer.childNodes.length), layer);
    expect(quoteOf(parts)).toBe('alpha bravo');
  });

  it('does not add a space between a trailing-space span and the next line', () => {
    const { layer } = layerOf(span('alpha '), br(), span('bravo', 30));
    const parts = selectedParts(range(layer, 0, layer, layer.childNodes.length), layer);
    expect(quoteOf(parts)).toBe('alpha bravo');
  });
});

describe('selectionInLayer (adversarial)', () => {
  it('yields a single box and quote for a one-word partial selection', () => {
    const { layer, spans } = layerOf(span('alphabet', 0, 10));
    const result = selectionInLayer(
      range(spans[0].firstChild!, 2, spans[0].firstChild!, 5),
      layer,
      layer.getBoundingClientRect(),
    );
    expect(result?.quote).toBe('pha');
    expect(result?.boxes.length).toBe(1);
  });

  it('does not include text of a following layer when the range ends there', () => {
    const a = layerOf(span('alpha'), br(), span('bravo', 30));
    const b = layerOf(span('foxtrot'));
    const result = selectionInLayer(
      range(a.spans[0].firstChild!, 0, b.spans[0].firstChild!, 7),
      a.layer,
      a.layer.getBoundingClientRect(),
    );
    expect(result?.quote).toBe('alpha bravo');
  });
});

describe('moveEndOfContent / resetMarker (adversarial)', () => {
  it('handles a range whose end is the endOfContent element itself', () => {
    const m = layerOf(span('alpha'), span('bravo', 30));
    expect(() =>
      moveEndOfContent(range(m.spans[0].firstChild!, 1, m.end, 0), null, [m]),
    ).not.toThrow();
    expect(m.layer.contains(m.end)).toBeTrue();
  });

  it('moves the marker to the end of a backward-growing selection (start side) on the first event', () => {
    // first selectionchange has no previous range: end side wins
    const m = layerOf(span('alpha'), span('bravo', 30), span('charlie', 60));
    moveEndOfContent(range(m.spans[0].firstChild!, 1, m.spans[1].firstChild!, 2), null, [m]);
    expect(m.spans[1].nextSibling).toBe(m.end);
  });

  it('follows the start when a backward drag shrinks/extends upward twice in a row', () => {
    const m = layerOf(span('alpha'), span('bravo', 30), span('charlie', 60));
    const first = range(m.spans[1].firstChild!, 1, m.spans[2].firstChild!, 2);
    moveEndOfContent(first, null, [m]);
    const second = range(m.spans[0].firstChild!, 1, m.spans[2].firstChild!, 2);
    moveEndOfContent(second, first, [m]);
    expect(m.end.nextSibling).toBe(m.spans[0]);
    const third = range(m.spans[0].firstChild!, 0, m.spans[2].firstChild!, 2);
    moveEndOfContent(third, second, [m]);
    expect(m.end.nextSibling).toBe(m.spans[0]);
  });

  it('moves the marker out of the way when the selection returns to the end side', () => {
    const m = layerOf(span('alpha'), span('bravo', 30), span('charlie', 60));
    const first = range(m.spans[0].firstChild!, 1, m.spans[2].firstChild!, 2);
    moveEndOfContent(first, null, [m]);
    const second = range(m.spans[0].firstChild!, 1, m.spans[1].firstChild!, 2);
    moveEndOfContent(second, first, [m]);
    expect(m.spans[1].nextSibling).toBe(m.end);
  });

  it('inside a markedContent wrapper the marker stays a sibling of the span (and inside the layer)', () => {
    const wrapper = document.createElement('span');
    wrapper.className = 'markedContent';
    wrapper.append(span('alpha'), span('bravo', 30));
    const m = layerOf(wrapper);
    moveEndOfContent(range(m.spans[0].firstChild!, 1, m.spans[1].firstChild!, 2), null, [m]);
    expect(m.layer.contains(m.end)).toBeTrue();
  });

  it('resetMarker is idempotent', () => {
    const m = layerOf(span('alpha'));
    resetMarker(m);
    resetMarker(m);
    expect(m.layer.lastChild).toBe(m.end);
    expect(m.layer.classList.contains('selecting')).toBeFalse();
  });

  it('markSelectingLayers resets every layer when the selection is outside all of them', () => {
    const m = layerOf(span('alpha'));
    m.layer.classList.add('selecting');
    const p = document.createElement('p');
    p.textContent = 'outside';
    document.body.append(p);
    track(p);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range(p.firstChild!, 0, p.firstChild!, 3));
    markSelectingLayers(sel, [m]);
    expect(m.layer.classList.contains('selecting')).toBeFalse();
  });

  it('markSelectingLayers marks both layers when a selection spans two', () => {
    const a = layerOf(span('alpha'));
    const b = layerOf(span('foxtrot'));
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range(a.spans[0].firstChild!, 1, b.spans[0].firstChild!, 3));
    markSelectingLayers(sel, [a, b]);
    expect(a.layer.classList.contains('selecting')).toBeTrue();
    expect(b.layer.classList.contains('selecting')).toBeTrue();
  });
});

describe('quoteOf breaksLine "between" correctness (final pass)', () => {
  function all(layer: Element): Range {
    return range(layer, 0, layer, layer.childNodes.length);
  }

  it('adds no space for same-line spans split by markedContent without a br', () => {
    const w1 = document.createElement('span');
    w1.className = 'markedContent';
    w1.append(span('foo'));
    const w2 = document.createElement('span');
    w2.className = 'markedContent';
    w2.append(span('bar', 0, 30));
    const { layer } = layerOf(w1, w2);
    expect(quoteOf(selectedParts(all(layer), layer))).toBe('foobar');
  });

  it('ignores a br that comes after the selected spans', () => {
    const { layer } = layerOf(span('foo'), span('bar', 0, 30), br(), span('baz', 30));
    const r = range(layer, 0, layer, 2);
    expect(quoteOf(selectedParts(r, layer))).toBe('foobar');
  });

  it('ignores a br that comes before the selected spans', () => {
    const { layer } = layerOf(span('zed'), br(), span('foo', 30), span('bar', 30, 30));
    const r = range(layer, 2, layer, 4);
    expect(quoteOf(selectedParts(r, layer))).toBe('foobar');
  });

  it('adds a space only at the gap that has a br in a three-span selection', () => {
    const { layer } = layerOf(span('foo'), span('bar', 0, 30), br(), span('baz', 30));
    expect(quoteOf(selectedParts(all(layer), layer))).toBe('foobar baz');
  });

  it('does not let a br in another layer split spans of this layer', () => {
    layerOf(span('other'), br(), span('line'));
    const { layer } = layerOf(span('foo'), span('bar', 0, 30));
    expect(quoteOf(selectedParts(all(layer), layer))).toBe('foobar');
  });

  it('returns the single span text for a one-part selection', () => {
    const { layer } = layerOf(br(), span('solo'), br());
    expect(quoteOf(selectedParts(all(layer), layer))).toBe('solo');
  });
});
