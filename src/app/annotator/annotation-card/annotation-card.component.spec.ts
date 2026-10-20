import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import type { Annotation } from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../annotator.data';
import { missingTranslationKeys } from '../testing/translation-keys/translation-keys';
import { AnnotationCardComponent } from './annotation-card.component';

// The fake translate loader answers with the key itself
const COLUMN_1 = 'CARD.TABLE_COLUMN_1';
const TABLE = `| ${COLUMN_1} | CARD.TABLE_COLUMN_2 |\n| --- | --- |\n|  |  |\n|  |  |\n`;

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    page: 3,
    rects: [[0, 0, 10, 10]],
    quote: 'highlighted text',
    comment: '',
    color: HIGHLIGHT_COLORS[0].value,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AnnotationCardComponent', () => {
  let fixture: ComponentFixture<AnnotationCardComponent>;
  let component: AnnotationCardComponent;

  function byTestId(id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function click(id: string): void {
    byTestId(id)?.click();
    fixture.detectChanges();
  }

  function render(inputs: Partial<Annotation> = {}, editing = false): void {
    fixture.componentRef.setInput('annotation', annotation(inputs));
    fixture.componentRef.setInput('editing', editing);
    fixture.detectChanges();
  }

  function editor(): HTMLTextAreaElement {
    return byTestId('annotation-card-editor') as HTMLTextAreaElement;
  }

  function keydown(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    editor().dispatchEvent(event);
    return event;
  }

  /** Types `text` into the editor and leaves the caret at its end. */
  function type(text: string): void {
    const textarea = editor();
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    textarea.setSelectionRange(text.length, text.length);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnnotationCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    fixture = TestBed.createComponent(AnnotationCardComponent);
    component = fixture.componentInstance;
  });

  it('carries the annotation id in the host data-testid', () => {
    render({ id: 'abc' });
    expect((fixture.nativeElement as HTMLElement).getAttribute('data-testid')).toBe(
      'annotation-card-abc',
    );
  });

  it('emits focusRequested from the page chip and from the quote', () => {
    render();
    const focus = jasmine.createSpy('focusRequested');
    component.focusRequested.subscribe(focus);
    click('annotation-card-page');
    click('annotation-card-quote');
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('emits the colour of the clicked swatch and marks the current one checked', () => {
    render({ color: HIGHLIGHT_COLORS[1].value });
    const changed = jasmine.createSpy('colorChanged');
    component.colorChanged.subscribe(changed);
    click('annotation-card-swatch-pink');
    expect(changed).toHaveBeenCalledWith(HIGHLIGHT_COLORS[3].value);
    expect(byTestId('annotation-card-swatch-green')?.getAttribute('aria-checked')).toBe('true');
    expect(byTestId('annotation-card-swatch-yellow')?.getAttribute('aria-checked')).toBe('false');
  });

  it('emits editRequested from the edit button and from add-comment, and deleteRequested', () => {
    render();
    const edit = jasmine.createSpy('editRequested');
    const remove = jasmine.createSpy('deleteRequested');
    component.editRequested.subscribe(edit);
    component.deleteRequested.subscribe(remove);
    click('annotation-card-edit');
    click('annotation-card-add-comment');
    click('annotation-card-delete');
    expect(edit).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('shows the rendered comment instead of the add-comment button when there is one', () => {
    render({ comment: '**bold**' });
    expect(byTestId('annotation-card-add-comment')).toBeNull();
    expect(byTestId('annotation-card-comment')?.innerHTML).toContain('<strong>bold</strong>');
  });

  it('hides the edit button and shows the editor with the comment while editing', () => {
    render({ comment: 'old note' }, true);
    expect(byTestId('annotation-card-edit')).toBeNull();
    expect(editor().value).toBe('old note');
    expect(byTestId('annotation-card-hint')).not.toBeNull();
  });

  it('saves the trimmed comment with Ctrl+Enter', () => {
    render({}, true);
    const saved = jasmine.createSpy('commentSaved');
    component.commentSaved.subscribe(saved);
    type('  my note \n');
    const event = keydown({ key: 'Enter', ctrlKey: true });
    expect(saved).toHaveBeenCalledOnceWith('my note');
    expect(event.defaultPrevented).toBeTrue();
  });

  it('cancels with Escape and stops it from reaching the page', () => {
    render({}, true);
    const cancelled = jasmine.createSpy('editCancelled');
    component.editCancelled.subscribe(cancelled);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stop = spyOn(event, 'stopPropagation');
    editor().dispatchEvent(event);
    expect(stop).toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('emits editCancelled from cancel and the trimmed comment from save', () => {
    render({}, true);
    const cancelled = jasmine.createSpy('editCancelled');
    const saved = jasmine.createSpy('commentSaved');
    component.editCancelled.subscribe(cancelled);
    component.commentSaved.subscribe(saved);
    type(' hello ');
    click('annotation-card-cancel');
    click('annotation-card-save');
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledOnceWith('hello');
  });

  it('switches between the write and preview tabs', () => {
    render({}, true);
    type('**x**');
    click('annotation-card-tab-preview');
    expect(byTestId('annotation-card-editor')).toBeNull();
    expect(byTestId('annotation-card-preview')?.innerHTML).toContain('<strong>x</strong>');
    expect(byTestId('annotation-card-insert-table')).toBeNull();
    click('annotation-card-tab-write');
    expect(byTestId('annotation-card-editor')).not.toBeNull();
  });

  describe('insert table', () => {
    it('inserts the skeleton as is into an empty editor and selects the first header', () => {
      render({}, true);
      click('annotation-card-insert-table');
      const textarea = editor();
      expect(textarea.value).toBe(TABLE);
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(COLUMN_1);
    });

    it('adds one blank line when the text before ends with a newline', () => {
      render({}, true);
      type('intro\n');
      click('annotation-card-insert-table');
      expect(editor().value).toBe('intro\n\n' + TABLE);
    });

    it('adds two newlines when the text before ends with text', () => {
      render({}, true);
      type('intro');
      click('annotation-card-insert-table');
      const textarea = editor();
      expect(textarea.value).toBe('intro\n\n' + TABLE);
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(COLUMN_1);
    });
  });

  describe('editor tabs', () => {
    function tabs(): HTMLElement[] {
      const list = byTestId('annotation-card-tablist')!;
      return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
    }

    it('has exactly two tabs in the tablist, and the insert button is outside it', () => {
      render({}, true);

      expect(tabs().length).toBe(2);
      const list = byTestId('annotation-card-tablist')!;
      expect(list.getAttribute('role')).toBe('tablist');
      expect(list.contains(byTestId('annotation-card-insert-table'))).toBeFalse();
    });

    it('points each tab at the panel, and the panel at the selected tab', () => {
      render({}, true);
      const panel = byTestId('annotation-card-panel')!;
      const [write, preview] = tabs();

      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(write.getAttribute('aria-controls')).toBe(panel.id);
      expect(preview.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.getAttribute('aria-labelledby')).toBe(write.id);

      click('annotation-card-tab-preview');

      expect(panel.getAttribute('aria-labelledby')).toBe(preview.id);
    });

    it('toggles aria-selected with the active tab', () => {
      render({}, true);
      const [write, preview] = tabs();
      expect([write.getAttribute('aria-selected'), preview.getAttribute('aria-selected')]).toEqual([
        'true',
        'false',
      ]);

      click('annotation-card-tab-preview');

      expect([write.getAttribute('aria-selected'), preview.getAttribute('aria-selected')]).toEqual([
        'false',
        'true',
      ]);
    });

    it('builds ids from the annotation id, so two cards do not collide', () => {
      render({ id: 'a1' }, true);
      const other = TestBed.createComponent(AnnotationCardComponent);
      other.componentRef.setInput('annotation', annotation({ id: 'b2' }));
      other.componentRef.setInput('editing', true);
      other.detectChanges();

      const ids = [fixture, other].flatMap((f) =>
        Array.from((f.nativeElement as HTMLElement).querySelectorAll('[id]')).map((el) => el.id),
      );

      expect(new Set(ids).size).toBe(ids.length);
      expect(tabs()[0].id).toContain('a1');
    });
  });

  it('only uses translation keys that exist in both bundles', () => {
    const keys = [
      'CARD.PAGE',
      'CARD.GO_TO_PAGE',
      'CARD.COLOR_GROUP',
      'CARD.EDIT',
      'CARD.DELETE_TITLE',
      'CARD.DELETE',
      'CARD.WRITE',
      'CARD.PREVIEW',
      'CARD.INSERT_TABLE',
      'CARD.INSERT_TABLE_TITLE',
      'CARD.NO_COMMENT',
      'CARD.EDITOR_LABEL',
      'CARD.EDITOR_PLACEHOLDER',
      'CARD.HINT',
      'CARD.CANCEL',
      'CARD.EDITOR_TABS',
      'CARD.SAVE',
      'CARD.ADD_COMMENT',
      'CARD.TABLE_COLUMN_1',
      'CARD.TABLE_COLUMN_2',
      ...HIGHLIGHT_COLORS.map((color) => color.labelKey),
    ];

    expect(missingTranslationKeys(keys)).toEqual([]);
  });
});
