/** An error whose message is a translation key, so the UI can show it in the active language. */
export class TranslatableError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = 'TranslatableError';
  }
}
