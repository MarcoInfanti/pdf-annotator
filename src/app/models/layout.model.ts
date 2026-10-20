/** How the pages and the UI are tinted to reduce glare. */
export type ReadingMode = 'normal' | 'sepia' | 'night';

/** A reading mode as offered in the toolbar. */
export interface ReadingModeOption {
  value: ReadingMode;
  /** Translation key of the mode name. */
  labelKey: string;
  /** Decorative glyph, rendered aria-hidden. */
  icon: string;
}

/** Languages the UI is translated into. */
export type SupportedLang = 'es' | 'en';

/** A language as offered by the switcher. */
export interface LanguageOption {
  lang: SupportedLang;
  /** Key of the language's own name ("Español", "English"): the button's accessible name. */
  labelKey: string;
  /** Key of the short visible code ("ES", "EN"). */
  shortKey: string;
}
