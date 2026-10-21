import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { InFlightWrite, OpenDocument, SaveStatus } from '../../models/annotator.model';
import { SaveScheduler } from '../../annotator/save-scheduler/save-scheduler';
import { errorNotice } from '../../annotator/translatable-error/translatable-error';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { AutosavePreferenceService } from '../../services/layout/autosave-preference.service';
import { AnnotatorSignals } from './annotator.signals';

/**
 * Everything about getting the annotations onto the disk: the manual save, the serialized write
 * queue and the state behind the toolbar's save indicator. Provided by `AnnotatorComponent` next
 * to `AnnotatorSignals`, which it reads and acts on through actions only (never the reverse).
 */
@Injectable()
export class AutosaveSignals {
  private readonly annotator = inject(AnnotatorSignals);
  private readonly files = inject(FileAccessService);
  private readonly codec = inject(PdfAnnotationCodecService);
  private readonly preference = inject(AutosavePreferenceService);

  private readonly _writing = signal(false);
  private readonly _savedOnce = signal(false);
  private readonly _paused = signal(false);
  private readonly _busy = signal(false);

  private readonly scheduler = new SaveScheduler(() => this.autosaveDue());
  /** Set when the timer fired while the editor was open: the save runs as soon as it closes. */
  private deferred = false;
  /** Write access is known for this document (granted at open, answered, or given by a Save). */
  private permissionSettled = false;
  /** The first-change permission prompt is open and unanswered. */
  private asking = false;
  private writeChain: Promise<unknown> = Promise.resolve();
  private inFlight: InFlightWrite | null = null;

  /** True while a manual save is running; autosave writes never set it. */
  readonly busy = this._busy.asReadonly();
  /** True while the user wants autosave (the stored preference). */
  readonly autosaveEnabled = this.preference.enabled;
  /** True when the open file can be autosaved: it has a writable handle and is not encrypted. */
  readonly autosaveAvailable = computed(() => {
    const doc = this.annotator.document();
    return !!doc?.handle && !doc.encrypted;
  });
  /** True when autosave is both wanted and possible for the open file. */
  readonly autosaveActive = computed(() => this.autosaveEnabled() && this.autosaveAvailable());
  /** What the toolbar indicator shows. */
  readonly saveStatus = computed<SaveStatus>(() => {
    if (this._writing()) return 'saving';
    if (this.autosaveActive() && this._paused()) return 'paused';
    if (this.annotator.dirty()) return 'unsaved';
    return this._savedOnce() ? 'saved' : 'idle';
  });

  constructor() {
    effect(() => this.resetForDocument(this.annotator.document()));
    effect(() => {
      const keep = !this.autosaveAvailable() || (this.autosaveEnabled() && this._paused());
      untracked(() => this.annotator.setRecoveryEnabled(keep));
    });
    effect(() => {
      this.annotator.revision();
      untracked(() => this.onChange());
    });
    effect(() => {
      const editingId = this.annotator.editingId();
      untracked(() => this.resumeAfterEditing(editingId));
    });
    inject(DestroyRef).onDestroy(() => this.scheduler.cancel());
  }

  /**
   * Turns autosave on or off and remembers the choice. Off stops what is scheduled; on clears a
   * pause (so a lost permission or an earlier error is tried again) and schedules a dirty document.
   */
  setAutosave(enabled: boolean): void {
    this.preference.set(enabled);
    if (enabled) {
      this._paused.set(false);
      this.onChange();
    } else {
      this.dropScheduled();
    }
  }

  /**
   * Asks for write access ahead of an action that will change the document after a long wait
   * (the JSON chooser), while the click that started it still counts as a user gesture. Does
   * nothing when autosave is off or unavailable, already paused, or access is already settled.
   */
  async requestWriteAccess(): Promise<void> {
    const idle = !this.permissionSettled && !this.asking && !this._paused();
    if (this.autosaveActive() && idle) await this.askPermission();
  }

  /**
   * Saves a pending change right now, for when the tab is hidden and may never come back. It
   * ignores the editor guard; text still being typed in the editor is not part of the document yet.
   */
  flushPendingSave(): void {
    if (!this.canAutosave()) return;
    this.dropScheduled();
    void this.autosave();
  }

  /**
   * Writes a pending change before another file replaces the session, ignoring the editor guard.
   * Resolves true when there is nothing to write or autosave is off, otherwise whether the write
   * worked; on false the caller decides whether the changes may be discarded.
   */
  async flushBeforeReplace(): Promise<boolean> {
    if (!this.autosaveActive() || !this.annotator.dirty()) return true;
    this.dropScheduled();
    return this.autosave();
  }

  /**
   * Saves into the same PDF when possible; otherwise downloads an annotated copy (or the JSON for
   * an encrypted PDF). Call it from a user gesture: it may have to ask for write permission.
   */
  async save(): Promise<void> {
    const doc = this.annotator.document();
    if (!doc) return;
    if (doc.encrypted) {
      this.annotator.exportJson();
      return;
    }
    this._busy.set(true);
    try {
      await (doc.handle ? this.saveToHandle(doc, doc.handle) : this.downloadPdf(doc));
    } catch (error) {
      console.error(error);
      this.annotator.reportNotice(errorNotice(error));
    } finally {
      this._busy.set(false);
    }
  }

  /** A new document starts clean and unpaused; write access is only asked for on its first change. */
  private resetForDocument(doc: OpenDocument | null): void {
    this.dropScheduled();
    this._savedOnce.set(false);
    this._paused.set(false);
    this.asking = false;
    this.permissionSettled = !!doc?.writeGranted;
  }

  /**
   * A change was made. The first one on a file whose access is not settled asks for write
   * permission right here, while the click or key press behind it is still a user gesture (a
   * timer would be too late); later ones are scheduled as usual.
   */
  private onChange(): void {
    if (!this.canAutosave() || this.asking) return;
    if (this.permissionSettled) this.scheduler.schedule();
    else void this.askPermission();
  }

  /** Asks once per document: a grant lets autosave go on, anything else pauses it quietly. */
  private async askPermission(): Promise<void> {
    const doc = this.annotator.document();
    if (!doc?.handle) return;
    this.asking = true;
    const granted = await this.files.requestWritePermission(doc.handle).catch(() => false);
    if (this.annotator.document() !== doc) return;
    this.asking = false;
    this.permissionSettled = true;
    if (granted) this.scheduleIfDue();
    else this._paused.set(true);
  }

  /** Autosave may write now: it is on, not paused, and there is something to save. */
  private canAutosave(): boolean {
    return this.autosaveActive() && !this._paused() && this.annotator.dirty();
  }

  private dropScheduled(): void {
    this.scheduler.cancel();
    this.deferred = false;
  }

  private scheduleIfDue(): void {
    if (this.canAutosave()) this.scheduler.schedule();
  }

  /** The timer fired: save now, or wait for the editor to close. */
  private autosaveDue(): void {
    if (!this.canAutosave()) return;
    if (this.annotator.editingId() !== null) this.deferred = true;
    else void this.autosave();
  }

  private resumeAfterEditing(editingId: string | null): void {
    if (editingId !== null || !this.deferred) return;
    this.dropScheduled();
    void this.autosave();
  }

  /**
   * Writes the document through the queue if it is still dirty by the time its turn comes. A lost
   * permission pauses autosave quietly; a failed write pauses it and says so once.
   *
   * @returns whether nothing went wrong
   */
  private async autosave(): Promise<boolean> {
    const doc = this.annotator.document();
    const handle = doc?.handle;
    if (!doc || !handle) return true;
    try {
      if (await this.files.hasWritePermission(handle)) {
        await this.enqueue(() => this.writeIfDirty(doc, handle));
        return true;
      }
    } catch (error) {
      console.error(error);
      this.annotator.reportNotice(errorNotice(error));
    }
    this._paused.set(true);
    return false;
  }

  private async writeIfDirty(doc: OpenDocument, handle: FileSystemFileHandle): Promise<void> {
    if (this.annotator.dirty()) await this.writeToHandle(doc, handle);
  }

  /** Downloads the annotated PDF for a file that cannot be overwritten. */
  private async downloadPdf(doc: OpenDocument): Promise<void> {
    const revision = this.annotator.revision();
    const bytes = await this.codec.encode(
      doc.cleanBytes,
      this.annotator.annotations(),
      this.annotator.position(),
    );
    this.files.download(bytes, doc.name, 'application/pdf');
    this.annotator.reportNotice({ key: 'NOTICE.DOWNLOADED' });
    this._savedOnce.set(true);
    this.annotator.markSaved(revision);
  }

  /**
   * Overwrites the file. If an autosave write of the current revision is already running, waits
   * for it instead of writing the same bytes twice, and writes itself only if that one failed.
   */
  private async saveToHandle(doc: OpenDocument, handle: FileSystemFileHandle): Promise<void> {
    this.dropScheduled();
    if (!(await this.files.requestWritePermission(handle))) {
      this.annotator.reportNotice({ key: 'NOTICE.PERMISSION_DENIED' });
      return;
    }
    const running = this.inFlight;
    const reused = running?.revision === this.annotator.revision() && (await running.done);
    if (!reused) await this.enqueue(() => this.writeToHandle(doc, handle));
    if (this.annotator.document() !== doc) return;
    this._paused.set(false);
    this.permissionSettled = true;
    this.annotator.reportNotice({ key: 'NOTICE.SAVED_IN', params: { name: doc.name } });
  }

  /** Runs the jobs one after another; a failing job does not break the chain for the next. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(job);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Encodes and overwrites the file. Resolves false without writing when the document has been
   * replaced meanwhile; a write failure is rethrown.
   */
  private async writeToHandle(doc: OpenDocument, handle: FileSystemFileHandle): Promise<boolean> {
    if (this.annotator.document() !== doc) return false;
    const write = this.encodeAndOverwrite(doc, handle, this.annotator.revision());
    this.inFlight = {
      revision: this.annotator.revision(),
      done: write.then(
        () => true,
        () => false,
      ),
    };
    this._writing.set(true);
    try {
      await write;
      return true;
    } finally {
      this._writing.set(false);
      this.inFlight = null;
    }
  }

  private async encodeAndOverwrite(
    doc: OpenDocument,
    handle: FileSystemFileHandle,
    revision: number,
  ): Promise<void> {
    const started = performance.now();
    const bytes = await this.codec.encode(
      doc.cleanBytes,
      this.annotator.annotations(),
      this.annotator.position(),
    );
    await this.files.overwrite(handle, bytes);
    this.scheduler.recordDuration(performance.now() - started);
    if (this.annotator.document() !== doc) return;
    this._savedOnce.set(true);
    this.annotator.markSaved(revision);
    await this.refreshBaseline(handle);
  }

  /** The copy of an unsaved session compares against the file as it is now; if unreadable, keep the old stamp. */
  private async refreshBaseline(handle: FileSystemFileHandle): Promise<void> {
    try {
      this.annotator.updateBaseline(await this.files.stampOf(handle));
    } catch {
      // The write succeeded, so it still counts as saved; only the stamp is stale.
    }
  }
}
