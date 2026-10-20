import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Annotation } from '../../models/annotator.model';
import { SidebarWidthService } from '../../services/layout/sidebar-width.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AnnotationCardComponent } from '../annotation-card/annotation-card.component';
import { SidebarResizerComponent } from '../sidebar-resizer/sidebar-resizer.component';

/** The comments panel: search box, annotation cards and the resize bar on its left edge. */
@Component({
  selector: 'app-annotator-sidebar',
  imports: [AnnotationCardComponent, SidebarResizerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotator-sidebar.component.html',
  styleUrl: './annotator-sidebar.component.scss',
})
export class AnnotatorSidebarComponent {
  protected readonly store = inject(AnnotatorSignals);
  protected readonly sidebarWidth = inject(SidebarWidthService);
  private readonly translate = inject(TranslateService);

  /** A card asked to be shown in the PDF; scrolling the viewer is the page's job. */
  readonly annotationFocused = output<Annotation>();

  /** DOM adapter: passes the search box text to the store. */
  protected changeSearch(event: Event): void {
    this.store.setSearch((event.target as HTMLInputElement).value);
  }

  /** Deletes the annotation after the user confirms. */
  protected remove(annotation: Annotation): void {
    // confirm() takes plain text read at click time, so it cannot use the pipe
    const question: unknown = this.translate.instant('CONFIRM.DELETE_ANNOTATION');
    if (typeof question === 'string' && confirm(question)) this.store.remove(annotation.id);
  }
}
