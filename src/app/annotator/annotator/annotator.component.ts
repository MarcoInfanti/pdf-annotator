import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Annotation, TextSelection, ViewerPosition } from '../../models/annotator.model';
import { HighlightPopupComponent } from '../highlight-popup/highlight-popup.component';
import { AnnotatorToolbarComponent } from '../annotator-toolbar/annotator-toolbar.component';
import { AnnotatorSidebarComponent } from '../annotator-sidebar/annotator-sidebar.component';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AutosaveSignals } from '../../signals/annotator/autosave.signals';
import { PdfViewerComponent } from '../pdf-viewer/pdf-viewer.component';

/** The annotator page: toolbar, PDF viewer, highlight popup and annotation sidebar. */
@Component({
  selector: 'app-annotator',
  imports: [
    TranslatePipe,
    AnnotatorToolbarComponent,
    HighlightPopupComponent,
    PdfViewerComponent,
    AnnotatorSidebarComponent,
  ],
  providers: [AnnotatorSignals, AutosaveSignals],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotator.component.html',
  styleUrl: './annotator.component.scss',
  host: {
    '(window:keydown)': 'handleShortcuts($event)',
    '(window:beforeunload)': 'warnUnsaved($event)',
    '(document:visibilitychange)': 'flushIfHidden()',
  },
})
export class AnnotatorComponent {
  /** The feature store, provided by this component so it lives and dies with it. */
  protected readonly store = inject(AnnotatorSignals);
  /** The save store, provided next to the feature store. */
  protected readonly autosave = inject(AutosaveSignals);
  private readonly translate = inject(TranslateService);
  private readonly viewer = viewChild(PdfViewerComponent);

  /** Text selection waiting for a colour; its presence is what shows the highlight popup. */
  protected readonly pendingSelection = signal<TextSelection | null>(null);

  /** Zooms so the first page fills the width, if the viewer can tell the scale. */
  protected fitWidth(): void {
    const scale = this.viewer()?.fitWidthScale();
    if (scale) this.store.setZoom(scale);
  }

  /**
   * Opens another PDF. With autosave off, unsaved changes are confirmed before the picker. With
   * autosave on, the picker comes first and a pending change is saved before the file replaces the
   * session; only a failed save asks for confirmation, and declining keeps the session.
   */
  protected async open(): Promise<void> {
    if (!this.autosave.autosaveActive() && this.store.dirty() && !this.confirmDiscard()) return;
    const picked = await this.store.pick();
    if (!picked) return;
    if (!(await this.autosave.flushBeforeReplace()) && !this.confirmDiscard()) return;
    // The bytes read at pick time predate the save when the same file was picked
    const fresh = await this.store.reread(picked);
    if (fresh) await this.store.load(fresh);
  }

  /** Jumps to the offered reading position; the offer goes away only if the viewer could jump. */
  protected resume(position: ViewerPosition): void {
    if (this.viewer()?.jumpTo(position)) this.store.dismissResume();
  }

  /** DOM adapter: a tab that is going away may never come back, so save a pending change now. */
  protected flushIfHidden(): void {
    if (document.visibilityState === 'hidden') this.autosave.flushPendingSave();
  }

  /** Turns the pending selection into an annotation of the chosen colour and clears the browser selection. */
  protected highlight(color: string): void {
    const selection = this.pendingSelection();
    if (!selection) return;
    this.store.add(selection, color);
    this.pendingSelection.set(null);
    document.getSelection()?.removeAllRanges();
  }

  /** Closes the highlight popup without highlighting anything. */
  protected dismissSelection(): void {
    this.pendingSelection.set(null);
  }

  /** A click on a highlight (or on empty space, with null) selects it and closes the popup. */
  protected selectFromPdf(id: string | null): void {
    this.pendingSelection.set(null);
    this.store.select(id);
  }

  /** Selects the annotation and scrolls the viewer to it. */
  protected focus(annotation: Annotation): void {
    this.store.select(annotation.id);
    this.viewer()?.scrollTo(annotation);
  }

  /** Ctrl+S saves, Ctrl +/-/0 zoom (with a document open), Escape closes the popup. */
  protected handleShortcuts(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.autosave.save();
    } else if (ctrl && this.store.document() && ['+', '=', '-', '0'].includes(event.key)) {
      // Replaces the browser zoom, which would also shrink the toolbar and sidebar.
      event.preventDefault();
      if (event.key === '0') this.store.setZoom(1);
      else this.store.zoom(event.key === '-' ? -1 : 1);
    } else if (event.key === 'Escape') {
      this.dismissSelection();
    }
  }

  /** Makes the browser ask for confirmation before leaving with unsaved changes or a write in flight. */
  protected warnUnsaved(event: BeforeUnloadEvent): void {
    if (this.store.dirty() || this.autosave.saveStatus() === 'saving') event.preventDefault();
  }

  private confirmDiscard(): boolean {
    // confirm() takes plain text read at click time, so it cannot use the pipe
    const question: unknown = this.translate.instant('CONFIRM.DISCARD_CHANGES');
    return typeof question === 'string' && confirm(question);
  }
}
