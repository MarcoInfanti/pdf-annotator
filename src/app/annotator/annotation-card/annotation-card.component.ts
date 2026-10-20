import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { Annotation } from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../annotator.data';
import { MarkdownPipe } from '../markdown/markdown.pipe';

/** One annotation in the sidebar: quote, colour, Markdown comment and its editor. */
@Component({
  selector: 'app-annotation-card',
  imports: [ReactiveFormsModule, MarkdownPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotation-card.component.html',
  styleUrl: './annotation-card.component.scss',
  host: {
    class: 'annotation-card',
    '[class.annotation-card--selected]': 'selected()',
    '[style.--accent]': 'annotation().color',
    '[attr.data-testid]': '"annotation-card-" + annotation().id',
  },
})
export class AnnotationCardComponent {
  readonly annotation = input.required<Annotation>();
  readonly selected = input(false);
  readonly editing = input(false);
  readonly focusRequested = output();
  readonly editRequested = output();
  readonly commentSaved = output<string>();
  readonly editCancelled = output();
  readonly deleteRequested = output();
  readonly colorChanged = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  protected readonly colors = HIGHLIGHT_COLORS;
  protected readonly comment = new FormControl('', { nonNullable: true });
  protected readonly preview = signal(false);

  constructor() {
    effect(() => {
      if (this.editing()) {
        this.comment.setValue(untracked(() => this.annotation().comment));
        this.preview.set(false);
      }
    });
    effect(() => this.textarea()?.nativeElement.focus());
    effect(() => {
      if (this.selected()) this.host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  protected save(): void {
    this.commentSaved.emit(this.comment.value.trim());
  }

  /** Inserts a table skeleton at the cursor, on its own lines, and selects its first header. */
  protected insertTable(): void {
    const textarea = this.textarea()?.nativeElement;
    if (!textarea) return;
    const value = this.comment.value;
    const start = textarea.selectionStart;
    const before = value.slice(0, start);
    const after = value.slice(textarea.selectionEnd);
    const prefix =
      before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const table = '| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |\n|  |  |\n';
    const suffix = after === '' || after.startsWith('\n') ? '' : '\n';
    this.comment.setValue(before + prefix + table + suffix + after);

    const headerStart = before.length + prefix.length + 2;
    textarea.focus();
    textarea.setSelectionRange(headerStart, headerStart + 'Columna 1'.length);
  }

  protected handleEditorKeys(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.save();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.editCancelled.emit();
    }
  }
}
