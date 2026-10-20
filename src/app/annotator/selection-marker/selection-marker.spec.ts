import type { SelectionMarker } from '../../models/annotator.model';
import { cleanup, layerOf, range, span, track } from '../testing/dom-builders/dom-builders';
import {
  markSelectingLayers,
  moveEndOfContent,
  resetMarker,
  usesMozUserSelect,
} from './selection-marker';

afterEach(cleanup);

function buildMarker(): SelectionMarker & { spans: HTMLSpanElement[] } {
  return layerOf(span('alpha'), span('bravo'), span('charlie'));
}

describe('moveEndOfContent', () => {
  it('places the marker right after the span the selection ends in', () => {
    const marker = buildMarker();
    const selected = range(marker.spans[0].firstChild!, 1, marker.spans[1].firstChild!, 2);
    moveEndOfContent(selected, null, [marker]);
    expect(marker.spans[1].nextSibling).toBe(marker.end);
    expect(marker.end.style.width).toBe('300px');
    expect(marker.end.style.height).toBe('200px');
  });

  it('places the marker before the start span when the selection grew at its start', () => {
    const marker = buildMarker();
    const previous = range(marker.spans[1].firstChild!, 1, marker.spans[2].firstChild!, 2);
    const selected = range(marker.spans[0].firstChild!, 1, marker.spans[2].firstChild!, 2);
    moveEndOfContent(selected, previous, [marker]);
    expect(marker.end.nextSibling).toBe(marker.spans[0]);
  });

  it('moves nothing when the end sits on the layer itself or outside every marker', () => {
    const marker = buildMarker();
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);
    track(outside);
    moveEndOfContent(range(marker.layer, 0, marker.layer, 1), null, [marker]);
    moveEndOfContent(range(outside.firstChild!, 0, outside.firstChild!, 3), null, [marker]);
    expect(marker.layer.lastChild).toBe(marker.end);
    expect(marker.end.style.width).toBe('');
  });
});

describe('resetMarker', () => {
  it('puts the marker back last, clears its size and the selecting class', () => {
    const marker = buildMarker();
    moveEndOfContent(range(marker.spans[0].firstChild!, 0, marker.spans[0].firstChild!, 2), null, [
      marker,
    ]);
    marker.layer.classList.add('selecting');
    resetMarker(marker);
    expect(marker.layer.lastChild).toBe(marker.end);
    expect(marker.end.style.width).toBe('');
    expect(marker.end.style.height).toBe('');
    expect(marker.layer.classList.contains('selecting')).toBeFalse();
  });
});

describe('markSelectingLayers', () => {
  it('marks the layer holding the selection and resets the others', () => {
    const first = buildMarker();
    const second = buildMarker();
    second.layer.classList.add('selecting');
    second.layer.prepend(second.end);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range(first.spans[0].firstChild!, 0, first.spans[1].firstChild!, 2));
    markSelectingLayers(selection, [first, second]);
    expect(first.layer.classList.contains('selecting')).toBeTrue();
    expect(second.layer.classList.contains('selecting')).toBeFalse();
    expect(second.layer.lastChild).toBe(second.end);
  });
});

describe('usesMozUserSelect', () => {
  it('is false in Chromium', () => {
    expect(usesMozUserSelect(buildMarker())).toBeFalse();
  });
});
