import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Annotation, TextSelection } from '../../models/annotator.model';
import { HighlightPopupComponent } from '../highlight-popup/highlight-popup.component';
import { AnnotatorToolbarComponent } from '../annotator-toolbar/annotator-toolbar.component';
import { AnnotatorSidebarComponent } from '../annotator-sidebar/annotator-sidebar.component';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
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
  providers: [AnnotatorSignals],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotator.component.html',
  styleUrl: './annotator.component.scss',
  host: {
    '(window:keydown)': 'handleShortcuts($event)',
    '(window:beforeunload)': 'warnUnsaved($event)',
  },
})
export class AnnotatorComponent {
  /** The feature store, provided by this component so it lives and dies with it. */
  protected readonly store = inject(AnnotatorSignals);
  private readonly translate = inject(TranslateService);
  private readonly viewer = viewChild(PdfViewerComponent);

  /** Text selection waiting for a colour; its presence is what shows the highlight popup. */
  protected readonly pendingSelection = signal<TextSelection | null>(null);

  /** Zooms so the first page fills the width, if the viewer can tell the scale. */
  protected fitWidth(): void {
    const scale = this.viewer()?.fitWidthScale();
    if (scale) this.store.setZoom(scale);
  }

  /** Confirms before discarding unsaved changes, then lets the store open another PDF. */
  protected open(): void {
    // confirm() takes plain text read at click time, so it cannot use the pipe
    const question: unknown = this.translate.instant('CONFIRM.DISCARD_CHANGES');
    if (this.store.dirty() && !(typeof question === 'string' && confirm(question))) return;
    void this.store.open();
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
      void this.store.save();
    } else if (ctrl && this.store.document() && ['+', '=', '-', '0'].includes(event.key)) {
      // Replaces the browser zoom, which would also shrink the toolbar and sidebar.
      event.preventDefault();
      if (event.key === '0') this.store.setZoom(1);
      else this.store.zoom(event.key === '-' ? -1 : 1);
    } else if (event.key === 'Escape') {
      this.dismissSelection();
    }
  }

  /** Makes the browser ask for confirmation before leaving with unsaved changes. */
  protected warnUnsaved(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }
}
