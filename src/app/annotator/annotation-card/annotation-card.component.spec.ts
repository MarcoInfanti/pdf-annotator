import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Annotation } from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../annotator.data';
import { AnnotationCardComponent } from './annotation-card.component';

const TABLE = '| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |\n|  |  |\n';

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
      providers: [provideZonelessChangeDetection()],
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
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(
        'Columna 1',
      );
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
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(
        'Columna 1',
      );
    });
  });
});
