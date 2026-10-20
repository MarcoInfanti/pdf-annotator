import type { ApplicationConfig } from '@angular/core';
import {
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { GlobalWorkerOptions } from 'pdfjs-dist';

/** Served from the build's assets (angular.json copies it from pdfjs-dist). */
const PDF_WORKER_SRC = 'pdf.worker.min.mjs';

/** Root providers: zoneless change detection, global error listeners and the pdf.js worker. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAppInitializer(() => {
      GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }),
  ],
};
