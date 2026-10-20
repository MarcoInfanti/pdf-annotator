import type { Annotation } from '../../models/annotator.model';
import { TranslatableError } from '../translatable-error/translatable-error';
import { parseAnnotationFile, serializeAnnotations } from './annotation-file';

const ANNOTATION: Annotation = {
  id: 'a',
  page: 1,
  rects: [[0, 0, 10, 10]],
  quote: 'quote',
  comment: 'note',
  color: '#ffd54f',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('annotation-file', () => {
  it('parses a valid version 1 file', () => {
    const json = JSON.stringify({ version: 1, annotations: [ANNOTATION] });

    expect(parseAnnotationFile(json)).toEqual([ANNOTATION]);
  });

  for (const [name, json] of [
    ['an unknown version', '{"version":2,"annotations":[]}'],
    ['missing annotations', '{"version":1}'],
    ['annotations that are not an array', '{"version":1,"annotations":{}}'],
  ]) {
    it(`throws a translatable error for ${name}`, () => {
      expect(() => parseAnnotationFile(json)).toThrowMatching(
        (error) => error instanceof TranslatableError && error.key === 'ERRORS.UNRECOGNIZED_FORMAT',
      );
    });
  }

  it('lets invalid JSON throw a SyntaxError', () => {
    expect(() => parseAnnotationFile('not json')).toThrowError(SyntaxError);
  });

  it('serialises as version 1 with the annotations', () => {
    expect(serializeAnnotations([ANNOTATION])).toBe(
      JSON.stringify({ version: 1, annotations: [ANNOTATION] }),
    );
  });
});
