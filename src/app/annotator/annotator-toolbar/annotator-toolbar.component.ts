import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { READING_MODES, ReadingModeService } from '../../services/layout/reading-mode.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AutosaveSignals } from '../../signals/annotator/autosave.signals';
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
  /** The feature store, provided by the page component. */
  protected readonly store = inject(AnnotatorSignals);
  /** Saving and the state of the save indicator, provided by the page component. */
  protected readonly autosave = inject(AutosaveSignals);
  /** Current reading mode and its setter. */
  protected readonly readingMode = inject(ReadingModeService);
  /** Reading modes offered by the toolbar buttons. */
  protected readonly readingModes = READING_MODES;

  /** The user asked to open a PDF; the page confirms unsaved changes first. */
  readonly openRequested = output();
  /** The user asked to fit the page width; only the viewer knows the resulting scale. */
  readonly fitWidthRequested = output();

  /**
   * Import is the one change that waits on a file chooser, possibly past the browser's window for
   * asking permission. So write access is requested on this click, before the chooser opens.
   */
  protected async importJson(): Promise<void> {
    await this.autosave.requestWriteAccess();
    if (activationExpired()) {
      // A chooser opened without activation is ignored by the browser and would hang the import
      this.store.reportNotice({ key: 'NOTICE.IMPORT_RETRY' });
      return;
    }
    await this.store.importJson();
  }

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

/** True when the browser reports that the click's user activation has run out; false if it cannot tell. */
function activationExpired(): boolean {
  const activation = (navigator as { userActivation?: UserActivation }).userActivation;
  return activation?.isActive === false;
}
