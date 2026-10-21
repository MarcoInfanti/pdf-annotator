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
  /** Number of pages; with the name it identifies the document in localStorage. */
  pageCount: number;
  /** Size and modification time of the file as it was opened. */
  stamp: FileStamp;
  /** True when the browser granted write permission for the handle at open time. */
  writeGranted: boolean;
}

/** Result of reading a PDF. */
export interface DecodedPdf {
  /** The PDF without this app's annotations: what gets rendered and re-annotated on save. */
  cleanBytes: Uint8Array;
  annotations: Annotation[];
  encrypted: boolean;
  /** Number of pages of the document. */
  pageCount: number;
  /** Reading position embedded in the PDF; null when absent, invalid or the PDF is encrypted. */
  position: ReadingPosition | null;
}

/** A file chosen by the user. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Present when the browser supports the File System Access API (Chrome, Edge). */
  handle: FileSystemFileHandle | null;
  /** Size and modification time of the file when it was picked. */
  stamp: FileStamp;
  /** True when write access was already granted at open (queried, never requested). Always false without a handle. */
  writeGranted: boolean;
}

/** Options of `window.showOpenFilePicker` that this app uses. */
export interface FilePickerOptions {
  types: { description: string; accept: Record<string, string[]> }[];
}

/** The File System Access picker function. */
export type FilePickerFunction = NonNullable<FilePickerWindow['showOpenFilePicker']>;

/** Rotations a PDF page can have. */
export type PageRotation = 0 | 90 | 180 | 270;

/** A write to the handle that has started and not finished. */
export interface InFlightWrite {
  /** Revision of the annotations that write is saving. */
  revision: number;
  /** Resolves with whether the write succeeded; never rejects. */
  done: Promise<boolean>;
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

/** A reading spot: 1-based page and the unrotated user-space point under the viewport's top-left corner. */
export interface ViewerPosition {
  page: number;
  x: number;
  y: number;
}

/** A stored reading position; zoom is informational (Continuar keeps the current zoom). */
export interface ReadingPosition extends ViewerPosition {
  zoom: number;
  /** ISO 8601 timestamp; the newer position wins. */
  updatedAt: string;
}

/** Vertical placement of a page inside the scroll container, in CSS pixels. */
export interface PageExtent {
  top: number;
  height: number;
}

/** Which page holds a scroll offset, and how far into it (CSS pixels). */
export interface PageHit {
  /** 0-based index into the page list. */
  index: number;
  offset: number;
}

/** Identifies a document in localStorage: `<name>|<pageCount>`. */
export interface DocumentIdentity {
  name: string;
  pageCount: number;
}

/** Size and modification time of a file; the baseline of a recovery copy. */
export interface FileStamp {
  size: number;
  lastModified: number;
}

/** Unsaved annotations kept in localStorage while changes cannot reach the disk. */
export interface RecoveryCopy {
  annotations: Annotation[];
  baseline: FileStamp;
}

/** What the toolbar save indicator shows. */
export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'paused';

/** Timer functions the save scheduler uses, injectable for specs. */
export interface SchedulerTimers {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  /** Monotonic milliseconds. */
  now(): number;
}

/** Argument of the File System Access permission methods. */
export interface WritePermissionDescriptor {
  mode: 'read' | 'readwrite';
}

/** A handle with the permission methods lib.dom lacks; absent in some browsers and in the e2e stub. */
export type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor: WritePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor: WritePermissionDescriptor) => Promise<PermissionState>;
};
