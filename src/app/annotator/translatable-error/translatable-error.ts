import type { Notice } from '../../models/annotator.model';

/** An error whose message is a translation key, so the UI can show it in the active language. */
export class TranslatableError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = 'TranslatableError';
  }
}

/** The notice for a failed file operation: the error's own key when it has one, else `NOTICE.ERROR`. */
export function errorNotice(error: unknown): Notice {
  if (error instanceof TranslatableError) return { key: error.key };
  const message = error instanceof Error ? error.message : String(error);
  return { key: 'NOTICE.ERROR', params: { message } };
}
