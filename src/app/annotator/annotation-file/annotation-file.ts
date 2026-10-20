import type { Annotation, AnnotationFile } from '../../models/annotator.model';

/** Reads the annotations of a `.annotations.json`; throws when the format is not recognised. */
export function parseAnnotationFile(json: string): Annotation[] {
  const data = JSON.parse(json) as Partial<AnnotationFile>;
  if (data.version !== 1 || !Array.isArray(data.annotations)) {
    throw new Error('Formato de anotaciones no reconocido');
  }
  return data.annotations;
}

/** Serialises annotations as a `.annotations.json` (also what is stored in the PDF catalog). */
export function serializeAnnotations(annotations: Annotation[]): string {
  const file: AnnotationFile = { version: 1, annotations };
  return JSON.stringify(file);
}
