import { computed, inject, Injectable, signal } from '@angular/core';
import type { Annotation, TextSelection } from './annotation.model';
import { HIGHLIGHT_COLORS, parseAnnotationFile, serializeAnnotations } from './annotation.model';
import type { PickedFile } from './file-access.service';
import { FileAccessService } from './file-access.service';
import type { DecodedPdf } from './pdf-annotation-codec';
import { PdfAnnotationCodec } from './pdf-annotation-codec';

interface OpenDocument {
  name: string;
  handle: FileSystemFileHandle | null;
  cleanBytes: Uint8Array;
  encrypted: boolean;
}

@Injectable({ providedIn: 'root' })
export class AnnotatorStore {
  private readonly files = inject(FileAccessService);
  private readonly codec = inject(PdfAnnotationCodec);

  private readonly _document = signal<OpenDocument | null>(null);
  private readonly _annotations = signal<Annotation[]>([]);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _editingId = signal<string | null>(null);
  private readonly _dirty = signal(false);
  private readonly _busy = signal(false);
  private readonly _notice = signal<string | null>(null);

  readonly document = this._document.asReadonly();
  readonly selectedId = this._selectedId.asReadonly();
  readonly editingId = this._editingId.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly notice = this._notice.asReadonly();
  readonly canOverwrite = computed(() => !!this._document()?.handle);
  readonly annotations = computed(() =>
    [...this._annotations()].sort((a, b) => a.page - b.page || topOf(b) - topOf(a)),
  );

  async open(): Promise<void> {
    if (this._dirty() && !confirm('Hay cambios sin guardar. ¿Abrir otro PDF de todos modos?')) {
      return;
    }
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

  exportJson(): void {
    const doc = this._document();
    if (!doc) return;
    const name = doc.name.replace(/\.pdf$/i, '') + '.annotations.json';
    this.files.download(serializeAnnotations(this._annotations()), name, 'application/json');
    if (doc.encrypted) this._dirty.set(false);
  }

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

  updateComment(id: string, comment: string): void {
    this.patch(id, { comment });
    this._editingId.set(null);
  }

  changeColor(id: string, color: string): void {
    this.patch(id, { color });
  }

  remove(id: string): void {
    this._annotations.update((list) => list.filter((a) => a.id !== id));
    if (this._selectedId() === id) this._selectedId.set(null);
    if (this._editingId() === id) this._editingId.set(null);
    this._dirty.set(true);
  }

  select(id: string | null): void {
    this._selectedId.set(id);
  }

  startEditing(id: string): void {
    this._selectedId.set(id);
    this._editingId.set(id);
  }

  stopEditing(): void {
    this._editingId.set(null);
  }

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

function topOf(annotation: Annotation): number {
  return Math.max(...annotation.rects.map((rect) => rect[3]));
}
