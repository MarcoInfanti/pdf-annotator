import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Annotation } from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../annotator.data';
import { MarkdownPipe } from '../markdown/markdown.pipe';

/** One annotation in the sidebar: quote, colour, Markdown comment and its editor. */
@Component({
  selector: 'app-annotation-card',
  imports: [ReactiveFormsModule, MarkdownPipe, TranslatePipe],
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

  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  protected readonly colors = HIGHLIGHT_COLORS;
  protected readonly comment = new FormControl('', { nonNullable: true });
  protected readonly preview = signal(false);

  /** Ids include the annotation id, so several cards on one page never collide. */
  protected readonly writeTabId = computed(
    () => `annotation-card-${this.annotation().id}-tab-write`,
  );
  protected readonly previewTabId = computed(
    () => `annotation-card-${this.annotation().id}-tab-preview`,
  );
  protected readonly panelId = computed(() => `annotation-card-${this.annotation().id}-panel`);

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
    const before = value.slice(0, textarea.selectionStart);
    const after = value.slice(textarea.selectionEnd);
    const prefix = this.separatorBefore(before);
    const { table, firstHeader } = this.tableSkeleton();
    const suffix = after === '' || after.startsWith('\n') ? '' : '\n';
    this.comment.setValue(before + prefix + table + suffix + after);

    const headerStart = before.length + prefix.length + 2;
    textarea.focus();
    textarea.setSelectionRange(headerStart, headerStart + firstHeader.length);
  }

  /** Newlines needed so the table starts on a blank line of its own. */
  private separatorBefore(before: string): string {
    if (before === '' || before.endsWith('\n\n')) return '';
    return before.endsWith('\n') ? '\n' : '\n\n';
  }

  /** The table in the active language, plus the first header (what gets selected). */
  private tableSkeleton(): { table: string; firstHeader: string } {
    const firstHeader = this.translated('CARD.TABLE_COLUMN_1');
    const secondHeader = this.translated('CARD.TABLE_COLUMN_2');
    const table = `| ${firstHeader} | ${secondHeader} |\n| --- | --- |\n|  |  |\n|  |  |\n`;
    return { table, firstHeader };
  }

  private translated(key: string): string {
    const text: unknown = this.translate.instant(key);
    return typeof text === 'string' ? text : key;
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
