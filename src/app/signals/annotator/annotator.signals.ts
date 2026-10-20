import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  Annotation,
  DecodedPdf,
  OpenDocument,
  PickedFile,
  TextSelection,
} from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../../annotator/annotator.data';
import {
  parseAnnotationFile,
  serializeAnnotations,
} from '../../annotator/annotation-file/annotation-file';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';

/** Zoom levels the toolbar offers and the zoom actions step through, ascending. */
const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** Lowest scale the viewer can be set to. */
const MIN_ZOOM = ZOOM_STEPS[0];

/** Highest scale the viewer can be set to. */
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Scale of a freshly opened viewer. */
const DEFAULT_ZOOM = 1.25;

/**
 * State of the open document and its annotations. Provided by `AnnotatorComponent`, so it lives
 * and dies with it; every write goes through an action.
 */
@Injectable()
export class AnnotatorSignals {
  private readonly files = inject(FileAccessService);
  private readonly codec = inject(PdfAnnotationCodecService);

  private readonly _document = signal<OpenDocument | null>(null);
  private readonly _annotations = signal<Annotation[]>([]);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _editingId = signal<string | null>(null);
  private readonly _dirty = signal(false);
  private readonly _busy = signal(false);
  private readonly _notice = signal<string | null>(null);
  private readonly _scale = signal(DEFAULT_ZOOM);
  private readonly _search = signal('');

  /** The PDF currently open, or null. */
  readonly document = this._document.asReadonly();
  /** Annotation highlighted in the viewer and the sidebar. */
  readonly selectedId = this._selectedId.asReadonly();
  /** Annotation whose comment editor is open. */
  readonly editingId = this._editingId.asReadonly();
  /** True when there are changes not yet written to the PDF or a JSON file. */
  readonly dirty = this._dirty.asReadonly();
  /** True while a file operation is running. */
  readonly busy = this._busy.asReadonly();
  /** Message for the notice bar; null when there is none. */
  readonly notice = this._notice.asReadonly();
  /** Viewer zoom factor (1 is 100%). */
  readonly scale = this._scale.asReadonly();
  /** Raw text typed in the sidebar search box. */
  readonly search = this._search.asReadonly();
  /** The zoom levels the toolbar offers. */
  readonly zoomSteps = ZOOM_STEPS;
  /** True when the open file can be saved in place. */
  readonly canOverwrite = computed(() => !!this._document()?.handle);
  /** Every annotation ordered by page, then from the top of the page down. */
  readonly annotations = computed(() =>
    [...this._annotations()].sort((a, b) => a.page - b.page || topOf(b) - topOf(a)),
  );
  /** The scale as a rounded percentage, for the toolbar when it is between steps. */
  readonly zoomPercent = computed(() => Math.round(this._scale() * 100));
  /** Highlights without a comment only show up while selected or being edited. */
  readonly listedAnnotations = computed(() => {
    const selectedId = this._selectedId();
    const editingId = this._editingId();
    return this.annotations().filter((a) => a.comment || a.id === selectedId || a.id === editingId);
  });
  /** Listed annotations whose quote or comment contains the search term (case-insensitive, trimmed). */
  readonly visibleAnnotations = computed(() => {
    const term = this._search().trim().toLowerCase();
    const listed = this.listedAnnotations();
    return term
      ? listed.filter((a) => (a.quote + ' ' + a.comment).toLowerCase().includes(term))
      : listed;
  });
  /** How many annotations have a comment. */
  readonly commentCount = computed(() => this._annotations().filter((a) => a.comment).length);

  /** Asks the user for a PDF and replaces the session with it. Confirming unsaved changes is the caller's job. */
  async open(): Promise<void> {
    await this.run(async () => {
      const picked = await this.files.pickPdf();
      if (!picked) return;
      this.applyDecoded(picked, await this.codec.decode(picked.bytes));
    });
  }

  /** Replaces the whole session state with a freshly opened document. */
  private applyDecoded(picked: PickedFile, decoded: DecodedPdf): void {
    this._document.set({
      name: picked.name,
      handle: picked.handle,
      cleanBytes: decoded.cleanBytes,
      encrypted: decoded.encrypted,
    });
    this._annotations.set(decoded.annotations);
    this._selectedId.set(null);
    this._editingId.set(null);
    this._dirty.set(false);
    this._notice.set(
      decoded.encrypted
        ? 'Este PDF está protegido: las anotaciones se guardarán en un archivo .json aparte.'
        : null,
    );
  }

  /** Saves into the same PDF when possible; otherwise downloads an annotated copy. */
  async save(): Promise<void> {
    const doc = this._document();
    if (!doc) return;
    if (doc.encrypted) {
      this.exportJson();
      return;
    }
    await this.run(async () => {
      const bytes = await this.codec.encode(doc.cleanBytes, this._annotations());
      if (doc.handle) {
        await this.files.overwrite(doc.handle, bytes);
        this._notice.set(`Guardado en ${doc.name}`);
      } else {
        this.files.download(bytes, doc.name, 'application/pdf');
        this._notice.set('Se ha descargado el PDF con las anotaciones.');
      }
      this._dirty.set(false);
    });
  }

  /** Downloads an annotated copy named `<name>-anotado.pdf`; the open document stays dirty. No-op for encrypted PDFs. */
  async saveCopy(): Promise<void> {
    const doc = this._document();
    if (!doc || doc.encrypted) return;
    await this.run(async () => {
      const bytes = await this.codec.encode(doc.cleanBytes, this._annotations());
      this.files.download(
        bytes,
        doc.name.replace(/\.pdf$/i, '') + '-anotado.pdf',
        'application/pdf',
      );
    });
  }

  /** Downloads the annotations as `<name>.annotations.json`. Only clears dirty for encrypted PDFs, where it is the way to save. */
  exportJson(): void {
    const doc = this._document();
    if (!doc) return;
    const name = doc.name.replace(/\.pdf$/i, '') + '.annotations.json';
    this.files.download(serializeAnnotations(this._annotations()), name, 'application/json');
    if (doc.encrypted) this._dirty.set(false);
  }

  /** Merges annotations from a JSON file, skipping ids already present. */
  async importJson(): Promise<void> {
    await this.run(async () => {
      const json = await this.files.pickText('.json,application/json');
      if (json === null) return;
      const imported = parseAnnotationFile(json);
      const known = new Set(this._annotations().map((a) => a.id));
      this._annotations.update((list) => [...list, ...imported.filter((a) => !known.has(a.id))]);
      this._dirty.set(true);
    });
  }

  /** Creates an empty annotation from a text selection, then selects it and opens its editor. */
  add(selection: TextSelection, color: string = HIGHLIGHT_COLORS[0].value): void {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      page: selection.page,
      rects: selection.rects,
      quote: selection.quote,
      comment: '',
      color,
      createdAt: now,
      updatedAt: now,
    };
    this._annotations.update((list) => [...list, annotation]);
    this._selectedId.set(annotation.id);
    this._editingId.set(annotation.id);
    this._dirty.set(true);
  }

  /** Stores the comment and closes the editor. */
  updateComment(id: string, comment: string): void {
    this.patch(id, { comment });
    this._editingId.set(null);
  }

  /** Changes the highlight colour (as rrggbb hex) of an annotation. */
  changeColor(id: string, color: string): void {
    this.patch(id, { color });
  }

  /** Deletes an annotation; selection and editing are cleared only if they pointed at it. */
  remove(id: string): void {
    this._annotations.update((list) => list.filter((a) => a.id !== id));
    if (this._selectedId() === id) this._selectedId.set(null);
    if (this._editingId() === id) this._editingId.set(null);
    this._dirty.set(true);
  }

  /** Highlights an annotation, or clears the selection with null. */
  select(id: string | null): void {
    this._selectedId.set(id);
  }

  /** Selects the annotation and opens its comment editor. */
  startEditing(id: string): void {
    this._selectedId.set(id);
    this._editingId.set(id);
  }

  /** Closes the comment editor. */
  stopEditing(): void {
    this._editingId.set(null);
  }

  /** Moves to the next zoom step, also from a scale between steps (e.g. after "fit width"). */
  zoom(direction: 1 | -1): void {
    const current = this._scale();
    const next =
      direction === 1
        ? ZOOM_STEPS.find((step) => step > current + 0.001)
        : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001);
    if (next !== undefined) this._scale.set(next);
  }

  /** Sets the zoom factor, clamped to the supported range; it need not be one of the steps. */
  setZoom(scale: number): void {
    this._scale.set(Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM));
  }

  /** Stores the search box text as typed; trimming and casing are applied when filtering. */
  setSearch(term: string): void {
    this._search.set(term);
  }

  /** Hides the notice bar. */
  dismissNotice(): void {
    this._notice.set(null);
  }

  private patch(id: string, changes: Partial<Annotation>): void {
    const updatedAt = new Date().toISOString();
    this._annotations.update((list) =>
      list.map((a) => (a.id === id ? { ...a, ...changes, updatedAt } : a)),
    );
    this._dirty.set(true);
  }

  /** Runs a file operation with busy set; a failure becomes an `Error:` notice instead of throwing. */
  private async run(action: () => Promise<void>): Promise<void> {
    this._busy.set(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      this._notice.set(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this._busy.set(false);
    }
  }
}

/** Highest y of the annotation rects: its vertical position on the page. */
function topOf(annotation: Annotation): number {
  return Math.max(...annotation.rects.map((rect) => rect[3]));
}
