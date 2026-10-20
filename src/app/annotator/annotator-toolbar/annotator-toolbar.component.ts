import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { READING_MODES, ReadingModeService } from '../../services/layout/reading-mode.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';

/**
 * The top bar: open, save, export/import, reading mode and zoom. It talks to the store provided
 * by the page; opening a file and fitting the width need the page, so they are outputs.
 */
@Component({
  selector: 'app-annotator-toolbar',
  imports: [DecimalPipe, LanguageSwitcherComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotator-toolbar.component.html',
  styleUrl: './annotator-toolbar.component.scss',
})
export class AnnotatorToolbarComponent {
  protected readonly store = inject(AnnotatorSignals);
  protected readonly readingMode = inject(ReadingModeService);
  protected readonly readingModes = READING_MODES;

  /** The user asked to open a PDF; the page confirms unsaved changes first. */
  readonly openRequested = output();
  /** The user asked to fit the page width; only the viewer knows the resulting scale. */
  readonly fitWidthRequested = output();

  /** DOM adapter for the zoom select: "fit" is a request to the page, anything else a scale. */
  protected changeZoom(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'fit') {
      this.fitWidthRequested.emit();
    } else {
      this.store.setZoom(Number(value));
    }
  }
}
