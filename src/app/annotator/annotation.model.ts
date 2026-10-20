/** Rectangle in PDF user space: [x1, y1, x2, y2] with x1 < x2 and y1 < y2. */
export type PdfRect = [number, number, number, number];

export interface Annotation {
  id: string;
  /** 1-based page number. */
  page: number;
  rects: PdfRect[];
  /** Text that was highlighted. */
  quote: string;
  /** Comment in Markdown. */
  comment: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextSelection {
  page: number;
  rects: PdfRect[];
  quote: string;
  clientX: number;
  clientY: number;
}

export const HIGHLIGHT_COLORS = [
  { value: '#ffd54f', label: 'Amarillo' },
  { value: '#81c784', label: 'Verde' },
  { value: '#64b5f6', label: 'Azul' },
  { value: '#f48fb1', label: 'Rosa' },
] as const;

export interface AnnotationFile {
  version: 1;
  annotations: Annotation[];
}

export function parseAnnotationFile(json: string): Annotation[] {
  const data = JSON.parse(json) as Partial<AnnotationFile>;
  if (data.version !== 1 || !Array.isArray(data.annotations)) {
    throw new Error('Formato de anotaciones no reconocido');
  }
  return data.annotations;
}

export function serializeAnnotations(annotations: Annotation[]): string {
  const file: AnnotationFile = { version: 1, annotations };
  return JSON.stringify(file);
}
