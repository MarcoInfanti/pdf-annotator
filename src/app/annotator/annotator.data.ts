import type { HighlightColor } from '../models/annotator.model';

/** Colours offered for highlights. Index 0 is the default for a new highlight. */
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { id: 'yellow', value: '#ffd54f', label: 'Amarillo' },
  { id: 'green', value: '#81c784', label: 'Verde' },
  { id: 'blue', value: '#64b5f6', label: 'Azul' },
  { id: 'pink', value: '#f48fb1', label: 'Rosa' },
];
