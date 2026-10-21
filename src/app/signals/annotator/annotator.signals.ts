import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  Notice,
  Annotation,
  DecodedPdf,
  FileStamp,
  OpenDocument,
  PickedFile,
  ReadingPosition,
  RecoveryCopy,
  TextSelection,
  ViewerPosition,
} from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../../annotator/annotator.data';
import { errorNotice } from '../../annotator/translatable-error/translatable-error';
import {
  parseAnnotationFile,
  serializeAnnotations,
} from '../../annotator/annotation-file/annotation-file';
import { isDocumentStart, newerPosition } from '../../annotator/reading-position/reading-position';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { SessionStorageService } from '../../services/annotator/session-storage.service';

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
  private readonly session = inject(SessionStorageService);

  private readonly _document = signal<OpenDocument | null>(null);
  private readonly _annotations = signal<Annotation[]>([]);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _editingId = signal<string | null>(null);
  private readonly _dirty = signal(false);
  private readonly _revision = signal(0);
  private readonly _busy = signal(false);
  private readonly _notice = signal<Notice | null>(null);
  private readonly _scale = signal(DEFAULT_ZOOM);
  private readonly _search = signal('');
  private readonly _position = signal<ReadingPosition | null>(null);
  private readonly _resumeCandidate = signal<ReadingPosition | null>(null);
  private readonly _documentStart = signal<ViewerPosition | null>(null);
  private readonly _recoveryOffer = signal<RecoveryCopy | null>(null);
  /** Stamp of the file as last seen on disk; not part of `document`, so refreshing it is quiet. */
  private readonly _baseline = signal<FileStamp>({ size: 0, lastModified: 0 });
  /** Whether changes are being copied to localStorage; see `setRecoveryEnabled`. */
  private keepRecovery = false;

  /** The PDF currently open, or null. */
  readonly document = this._document.asReadonly();
  /** Annotation highlighted in the viewer and the sidebar. */
  readonly selectedId = this._selectedId.asReadonly();
  /** Annotation whose comment editor is open. */
  readonly editingId = this._editingId.asReadonly();
  /** True when there are changes not yet written to the PDF or a JSON file. */
  readonly dirty = this._dirty.asReadonly();
  /** Counts real changes to the annotations; lets a save tell whether anything changed during it. */
  readonly revision = this._revision.asReadonly();
  /** True while a file operation is running. */
  readonly busy = this._busy.asReadonly();
  /** Message for the notice bar, as a translation key plus params; null when there is none. */
  readonly notice = this._notice.asReadonly();
  /** Viewer zoom factor (1 is 100%). */
  readonly scale = this._scale.asReadonly();
  /** Raw text typed in the sidebar search box. */
  readonly search = this._search.asReadonly();
  /** Where the user is reading, once the viewer has reported it this session; null until then. */
  readonly position = this._position.asReadonly();
  /**
   * Where to offer continuing: the newer of the position stored in the browser and the one in the
   * PDF, unless it is the start of the document. Null when there is nothing to offer.
   */
  readonly resumeOffer = computed(() => {
    const candidate = this._resumeCandidate();
    const start = this._documentStart();
    return candidate && start && !isDocumentStart(candidate, start) ? candidate : null;
  });
  /** Unsaved annotations from an earlier session with this file, waiting to be recovered or declined. */
  readonly recoveryOffer = this._recoveryOffer.asReadonly();
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
    const picked = await this.pick();
    if (picked) await this.load(picked);
  }

  /**
   * Shows the file picker and changes no session state. Resolves `null` when cancelled or when
   * the picker fails (the failure becomes a notice).
   */
  async pick(): Promise<PickedFile | null> {
    let picked: PickedFile | null = null;
    await this.run(async () => {
      picked = await this.files.pickPdf();
    });
    return picked;
  }

  /**
   * Reads a picked file again from disk. Needed after a save, when the bytes read at pick time
   * may predate the write (the same file was picked). Null, with a notice, when it cannot be read.
   */
  async reread(picked: PickedFile): Promise<PickedFile | null> {
    let fresh: PickedFile | null = null;
    await this.run(async () => {
      fresh = await this.files.refresh(picked);
    });
    return fresh;
  }

  /** Decodes a picked file and replaces the whole session with it. */
  async load(picked: PickedFile): Promise<void> {
    await this.run(async () => {
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
      pageCount: decoded.pageCount,
      stamp: picked.stamp,
      writeGranted: picked.writeGranted,
    });
    this._annotations.set(decoded.annotations);
    this._selectedId.set(null);
    this._editingId.set(null);
    this._dirty.set(false);
    this._baseline.set(picked.stamp);
    this.offerResume(picked.name, decoded);
    this.offerRecovery(picked.stamp, decoded.annotations);
    this._notice.set(decoded.encrypted ? { key: 'NOTICE.ENCRYPTED' } : null);
  }

  /** Downloads an annotated copy named `<name>-anotado.pdf`; the open document stays dirty. No-op for encrypted PDFs. */
  async saveCopy(): Promise<void> {
    const doc = this._document();
    if (!doc || doc.encrypted) return;
    await this.run(async () => {
      const bytes = await this.codec.encode(doc.cleanBytes, this._annotations(), this._position());
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
    if (doc.encrypted) this.clearSaved();
  }

  /** Merges annotations from a JSON file, skipping ids already present; changes nothing if none is new. */
  async importJson(): Promise<void> {
    await this.run(async () => {
      const json = await this.files.pickText('.json,application/json');
      if (json === null) return;
      const imported = parseAnnotationFile(json);
      if (this.mergeById(imported)) this.markDirty();
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
    this.markDirty();
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
    if (!this._annotations().some((a) => a.id === id)) return;
    this._annotations.update((list) => list.filter((a) => a.id !== id));
    if (this._selectedId() === id) this._selectedId.set(null);
    if (this._editingId() === id) this._editingId.set(null);
    this.markDirty();
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

  /**
   * Clears the unsaved flag, but only when nothing changed since `revision` was read. A save
   * reads the revision before it encodes, so an edit made during the write stays unsaved.
   */
  markSaved(revision: number): void {
    if (revision === this._revision()) this.clearSaved();
  }

  /** Remembers the size and modification time of the file after a write, for the recovery copy. */
  updateBaseline(stamp: FileStamp): void {
    this._baseline.set(stamp);
  }

  /**
   * Starts or stops copying changes to localStorage. Starting while dirty copies at once. Stopping
   * deletes nothing: an existing copy stays as it was until the next successful save clears it.
   */
  setRecoveryEnabled(enabled: boolean): void {
    this.keepRecovery = enabled;
    if (enabled && this._dirty()) this.writeRecovery();
  }

  /**
   * Restores the unsaved annotations of an earlier session. If the file is unchanged since the
   * copy was made, they replace the current ones exactly; otherwise they are merged in by id.
   */
  recover(): void {
    const copy = this._recoveryOffer();
    const doc = this._document();
    if (!copy || !doc) return;
    if (sameStamp(copy.baseline, doc.stamp)) {
      this._annotations.set(copy.annotations);
      this._selectedId.set(null);
      this._editingId.set(null);
      this.markDirty();
    } else if (this.mergeById(copy.annotations)) {
      this.markDirty();
    }
    this._recoveryOffer.set(null);
  }

  /** Closes the recovery offer but keeps the copy for the next time the file is opened. */
  dismissRecovery(): void {
    this._recoveryOffer.set(null);
  }

  /** Shows a message in the notice bar; used by the autosave store for its outcomes. */
  reportNotice(notice: Notice): void {
    this._notice.set(notice);
  }

  /**
   * Records where the user is reading: remembered in the browser and, from the next save on,
   * written into the PDF. Never marks the document dirty. The zoom is the current scale.
   */
  setPosition(view: ViewerPosition): void {
    const doc = this._document();
    if (!doc) return;
    const position: ReadingPosition = {
      ...view,
      zoom: this._scale(),
      updatedAt: new Date().toISOString(),
    };
    this._position.set(position);
    this.session.writePosition({ name: doc.name, pageCount: doc.pageCount }, position);
  }

  /** The top of page 1 as the viewer measured it; a position equal to it is not worth offering. */
  setDocumentStart(start: ViewerPosition): void {
    this._documentStart.set(start);
  }

  /** Closes the resume offer, whether the user used it or declined it. */
  dismissResume(): void {
    this._resumeCandidate.set(null);
  }

  /** Hides the notice bar. */
  dismissNotice(): void {
    this._notice.set(null);
  }

  /** Forgets the previous document's position and picks the newest known one as the offer. */
  private offerResume(name: string, decoded: DecodedPdf): void {
    this._position.set(null);
    this._documentStart.set(null);
    const found = this.session.readPosition({ name, pageCount: decoded.pageCount });
    // A page beyond the document cannot be shown; ignored silently, like the embedded one
    const stored = found && found.page <= decoded.pageCount ? found : null;
    this._resumeCandidate.set(newerPosition(stored, decoded.position));
  }

  private markDirty(): void {
    this._revision.update((value) => value + 1);
    this._dirty.set(true);
    // The user went on editing, so restoring an older session is no longer on offer
    this._recoveryOffer.set(null);
    if (this.keepRecovery) this.writeRecovery();
  }

  /** Everything is on disk (or in a file the user has): clean again, and the copy is not needed. */
  private clearSaved(): void {
    this._dirty.set(false);
    this._recoveryOffer.set(null);
    const doc = this._document();
    if (doc) this.session.clearRecovery({ name: doc.name, pageCount: doc.pageCount });
  }

  private writeRecovery(): void {
    const doc = this._document();
    if (!doc) return;
    const identity = { name: doc.name, pageCount: doc.pageCount };
    this.session.writeRecovery(identity, this._annotations(), this._baseline());
  }

  /** Appends the annotations whose ids are not present yet; returns whether any was added. */
  private mergeById(imported: Annotation[]): boolean {
    const known = new Set(this._annotations().map((a) => a.id));
    const fresh = imported.filter((a) => !known.has(a.id));
    if (fresh.length) this._annotations.update((list) => [...list, ...fresh]);
    return fresh.length > 0;
  }

  /** Offers the stored copy if it has something to give back; a useless one is cleared silently. */
  private offerRecovery(stamp: FileStamp, opened: Annotation[]): void {
    const doc = this._document();
    if (!doc) return;
    const identity = { name: doc.name, pageCount: doc.pageCount };
    const copy = this.session.readRecovery(identity);
    const recoverable = !!copy && isRecoverable(copy, stamp, opened);
    if (copy && !recoverable) this.session.clearRecovery(identity);
    this._recoveryOffer.set(recoverable ? copy : null);
  }

  /** Applies the changes to one annotation; an unknown id or values it already has change nothing. */
  private patch(id: string, changes: Partial<Annotation>): void {
    const current = this._annotations().find((a) => a.id === id);
    const entries = Object.entries(changes) as [keyof Annotation, unknown][];
    if (!current || entries.every(([key, value]) => current[key] === value)) return;
    const updatedAt = new Date().toISOString();
    this._annotations.update((list) =>
      list.map((a) => (a.id === id ? { ...a, ...changes, updatedAt } : a)),
    );
    this.markDirty();
  }

  /** Runs a file operation with busy set; a failure becomes an `Error:` notice instead of throwing. */
  private async run(action: () => Promise<void>): Promise<void> {
    this._busy.set(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      this._notice.set(errorNotice(error));
    } finally {
      this._busy.set(false);
    }
  }
}

/** Highest y of the annotation rects: its vertical position on the page. */
function topOf(annotation: Annotation): number {
  return Math.max(...annotation.rects.map((rect) => rect[3]));
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.size === b.size && a.lastModified === b.lastModified;
}

/**
 * A copy made against this very file replaces the annotations, so it matters when they differ; a
 * copy made against another version of the file is merged, so it matters when it adds something.
 */
function isRecoverable(copy: RecoveryCopy, stamp: FileStamp, opened: Annotation[]): boolean {
  if (sameStamp(copy.baseline, stamp)) {
    return serializeAnnotations(copy.annotations) !== serializeAnnotations(opened);
  }
  const known = new Set(opened.map((a) => a.id));
  return copy.annotations.some((a) => !known.has(a.id));
}
