import type { ApplicationConfig } from '@angular/core';
import {
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';
import { GlobalWorkerOptions } from 'pdfjs-dist';

import { LanguageService } from './services/layout/language.service';
import { InlineTranslateLoader } from './shared/inline-translate-loader/inline-translate-loader';

/** Served from the build's assets (angular.json copies it from pdfjs-dist). */
const PDF_WORKER_SRC = 'pdf.worker.min.mjs';

/**
 * Root providers: zoneless change detection, global error listeners, the translations (bundled,
 * no HTTP) and the startup work: the pdf.js worker and the initial language.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideTranslateService({
      fallbackLang: 'es',
      loader: provideTranslateLoader(InlineTranslateLoader),
    }),
    provideAppInitializer(() => {
      GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }),
    provideAppInitializer(() => {
      inject(LanguageService).initialize();
    }),
  ],
};
