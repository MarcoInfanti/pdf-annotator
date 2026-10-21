import { errorNotice, TranslatableError } from './translatable-error';

describe('TranslatableError', () => {
  it('keeps the translation key and uses it as the message', () => {
    const error = new TranslatableError('ERRORS.UNRECOGNIZED_FORMAT');

    expect(error.key).toBe('ERRORS.UNRECOGNIZED_FORMAT');
    expect(error.message).toBe('ERRORS.UNRECOGNIZED_FORMAT');
  });

  it('is an Error and a TranslatableError, so callers can tell it apart', () => {
    const error = new TranslatableError('X.Y');

    expect(error instanceof Error).toBeTrue();
    expect(error instanceof TranslatableError).toBeTrue();
    expect(error.name).toBe('TranslatableError');
  });
});

describe('errorNotice', () => {
  it('keeps the key of a translatable error', () => {
    expect(errorNotice(new TranslatableError('X.Y'))).toEqual({ key: 'X.Y' });
  });

  it('describes any other failure by its message or text', () => {
    expect(errorNotice(new Error('boom'))).toEqual({
      key: 'NOTICE.ERROR',
      params: { message: 'boom' },
    });
    expect(errorNotice('plain')).toEqual({ key: 'NOTICE.ERROR', params: { message: 'plain' } });
  });
});
