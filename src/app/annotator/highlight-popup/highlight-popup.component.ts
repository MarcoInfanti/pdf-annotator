import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { TextSelection } from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../annotator.data';

/** Colour picker floating next to a fresh text selection. */
@Component({
  selector: 'app-highlight-popup',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './highlight-popup.component.html',
  styleUrl: './highlight-popup.component.scss',
  host: {
    class: 'highlight-popup',
    '[style.left.px]': 'selection().clientX',
    '[style.top.px]': 'selection().clientY + 12',
    '(document:mousedown)': 'dismissOutside($event)',
  },
})
export class HighlightPopupComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The selection to highlight; the popup is anchored at its mouse position. */
  readonly selection = input.required<TextSelection>();
  /** The user picked a colour; carries its `#rrggbb` value. */
  readonly colorPicked = output<string>();
  /** The user pressed the mouse outside the popup. */
  readonly dismissed = output();

  protected readonly colors = HIGHLIGHT_COLORS;

  /** Emits `dismissed` for a mousedown anywhere but on the popup itself. */
  protected dismissOutside(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.dismissed.emit();
  }
}
