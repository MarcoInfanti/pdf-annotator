import type { PDFPageProxy } from 'pdfjs-dist';

/** Rectangle in PDF user space: [x1, y1, x2, y2] with x1 < x2 and y1 < y2. */
export type PdfRect = [number, number, number, number];

/** A highlight with its optional Markdown comment, as stored in the PDF and in JSON exports. */
export interface Annotation {
  /** UUID; also written as /NM and /PdfAnnotationsId in the PDF. */
  id: string;
  /** 1-based page number. */
  page: number;
  /** One rect per highlighted text line, in PDF user space. */
  rects: PdfRect[];
  /** Text that was highlighted. */
  quote: string;
  /** Comment in Markdown. */
  comment: string;
  /** Highlight colour as `#rrggbb`. */
  color: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** A text selection captured on one page, plus where the mouse was released (popup anchor). */
export interface TextSelection {
  page: number;
  rects: PdfRect[];
  quote: string;
  /** Viewport x coordinate of the mouseup. */
  clientX: number;
  /** Viewport y coordinate of the mouseup. */
  clientY: number;
}

/** The `.annotations.json` file format. */
export interface AnnotationFile {
  version: 1;
  annotations: Annotation[];
}

/** Stable id of a highlight colour; builds test ids. */
export type HighlightColorId = 'yellow' | 'green' | 'blue' | 'pink';

/** A colour offered for highlights. */
export interface HighlightColor {
  id: HighlightColorId;
  /** What gets stored on the annotation, as `#rrggbb`. */
  value: string;
  /** Translation key of the colour name. */
  labelKey: string;
}

/** The PDF currently open. */
export interface OpenDocument {
  name: string;
  /** Present when the file can be overwritten in place (File System Access API). */
  handle: FileSystemFileHandle | null;
  /** The PDF without this app's annotations; what is rendered and re-annotated on save. */
  cleanBytes: Uint8Array;
  encrypted: boolean;
}

/** Result of reading a PDF. */
export interface DecodedPdf {
  /** The PDF without this app's annotations: what gets rendered and re-annotated on save. */
  cleanBytes: Uint8Array;
  annotations: Annotation[];
  encrypted: boolean;
}

/** A file chosen by the user. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Present when the browser supports the File System Access API (Chrome, Edge). */
  handle: FileSystemFileHandle | null;
}

/** Options of `window.showOpenFilePicker` that this app uses. */
export interface FilePickerOptions {
  types: { description: string; accept: Record<string, string[]> }[];
}

/** `window`, with the File System Access picker that only some browsers have. */
export type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
};

/** A message for the notice bar, translated in the template so it follows language switches. */
export interface Notice {
  /** Translation key. */
  key: string;
  /** Values for the `{{name}}` placeholders of the message. */
  params?: Record<string, string | number>;
}

/** Axis-aligned rectangle in page-relative CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One selected text span and the part of it that the selection covers. */
export interface SpanPart {
  span: Element;
  range: Range;
}

/** What a selection covers on one page, in page-relative CSS pixels. */
export interface SelectedText {
  boxes: Box[];
  quote: string;
}

/** A rendered text layer and its pdf.js-style end-of-content marker. */
export interface SelectionMarker {
  layer: HTMLElement;
  end: HTMLElement;
}

/** One drawn highlight rectangle and the annotation it belongs to. */
export interface HighlightBox extends Box {
  id: string;
  color: string;
}

/** pdf.js page viewport (scale + transform). */
export type PdfViewport = ReturnType<PDFPageProxy['getViewport']>;

/** A cancellable pdf.js canvas render. */
export type PdfRenderTask = ReturnType<PDFPageProxy['render']>;
