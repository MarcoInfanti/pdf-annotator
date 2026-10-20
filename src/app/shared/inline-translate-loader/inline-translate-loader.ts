import { Injectable } from '@angular/core';
import type { TranslationObject } from '@ngx-translate/core';
import { TranslateLoader } from '@ngx-translate/core';
import type { Observable } from 'rxjs';
import { of } from 'rxjs';

import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';

const BUNDLES: Record<string, TranslationObject> = { es, en };

/**
 * Serves the translation bundles compiled into the main chunk, so a language switch needs no
 * request and the first paint never shows raw keys. An unknown language gets Spanish.
 */
@Injectable()
export class InlineTranslateLoader extends TranslateLoader {
  /** Emits synchronously: the bundles are already in memory. */
  getTranslation(lang: string): Observable<TranslationObject> {
    return of(BUNDLES[lang] ?? es);
  }
}
