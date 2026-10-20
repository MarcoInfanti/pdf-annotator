import { Injectable, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';

import type { LanguageOption, SupportedLang } from '../../models/layout.model';

/** Languages offered by the switcher, in display order. */
export const LANGUAGES: readonly LanguageOption[] = [
  { lang: 'es', labelKey: 'LANGUAGE.ES', shortKey: 'LANGUAGE.ES_SHORT' },
  { lang: 'en', labelKey: 'LANGUAGE.EN', shortKey: 'LANGUAGE.EN_SHORT' },
];

const STORAGE_KEY = 'pdf-annotations.language';

/**
 * The UI language. The stored choice wins, otherwise the browser's decides. Applying a language
 * also updates `<html lang>` and the document title.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly title = inject(Title);
  private readonly _current = signal<SupportedLang>('es');

  /** The active language. */
  readonly current = this._current.asReadonly();

  /** Picks the stored language, else the browser's, and applies it. Runs once at startup. */
  initialize(): void {
    this.apply(this.readStored() ?? this.detectBrowserLang());
  }

  /** Applies the language and remembers it; storage failures are ignored. */
  setLanguage(lang: SupportedLang): void {
    this.apply(lang);
    this.persist(lang);
  }

  private apply(lang: SupportedLang): void {
    // use() before the signal: computeds that read current() must see the loaded translations
    this.translate.use(lang);
    this._current.set(lang);
    document.documentElement.lang = lang;
    const title: unknown = this.translate.instant('APP.TITLE');
    if (typeof title === 'string') this.title.setTitle(title);
  }

  private readStored(): SupportedLang | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return LANGUAGES.find((option) => option.lang === stored)?.lang ?? null;
    } catch {
      return null;
    }
  }

  private persist(lang: SupportedLang): void {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage unavailable (private mode): the language just isn't remembered.
    }
  }

  private detectBrowserLang(): SupportedLang {
    return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
  }
}
