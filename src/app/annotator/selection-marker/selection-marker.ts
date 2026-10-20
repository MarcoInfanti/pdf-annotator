import type { SelectionMarker } from '../../models/annotator.model';

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
