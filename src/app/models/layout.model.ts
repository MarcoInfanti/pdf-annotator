/** How the pages and the UI are tinted to reduce glare. */
export type ReadingMode = 'normal' | 'sepia' | 'night';

/** A reading mode as offered in the toolbar. */
export interface ReadingModeOption {
  value: ReadingMode;
  /** Name shown to the user. */
  label: string;
  /** Decorative glyph, rendered aria-hidden. */
  icon: string;
}
