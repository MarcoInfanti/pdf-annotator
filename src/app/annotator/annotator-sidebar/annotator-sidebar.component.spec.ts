import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Annotation, TextSelection } from '../../models/annotator.model';
import { FileAccessService } from '../../services/annotator/file-access.service';
import { PdfAnnotationCodecService } from '../../services/annotator/pdf-annotation-codec.service';
import { SidebarWidthService } from '../../services/layout/sidebar-width.service';
import { AnnotatorSignals } from '../../signals/annotator/annotator.signals';
import { AnnotationCardComponent } from '../annotation-card/annotation-card.component';
import { AnnotatorSidebarComponent } from './annotator-sidebar.component';

function selection(top: number): TextSelection {
  return { page: 1, rects: [[0, 0, 10, top]], quote: 'q' + String(top), clientX: 0, clientY: 0 };
}

describe('AnnotatorSidebarComponent', () => {
  let fixture: ComponentFixture<AnnotatorSidebarComponent>;
  let store: AnnotatorSignals;

  function byTestId(id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function cards(): AnnotationCardComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(AnnotationCardComponent))
      .map((card) => card.componentInstance as AnnotationCardComponent);
  }

  /** Adds a commented annotation, so it stays listed without being selected. */
  function addCommented(top: number): Annotation {
    store.add(selection(top));
    const id = store.selectedId()!;
    store.updateComment(id, 'comment ' + String(top));
    fixture.detectChanges();
    return store.annotations().find((a) => a.id === id)!;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnnotatorSidebarComponent],
      providers: [
        provideZonelessChangeDetection(),
        AnnotatorSignals,
        { provide: FileAccessService, useValue: {} },
        { provide: PdfAnnotationCodecService, useValue: {} },
      ],
    });
    store = TestBed.inject(AnnotatorSignals);
    fixture = TestBed.createComponent(AnnotatorSidebarComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('pdf-annotations.sidebar-width');
  });

  it('shows the empty state when there are no annotations', () => {
    expect(byTestId('annotator-sidebar-empty')).not.toBeNull();
    expect(cards().length).toBe(0);
  });

  it('renders one card per visible annotation and counts the commented ones', () => {
    addCommented(10);
    addCommented(20);

    expect(cards().length).toBe(2);
    expect(byTestId('annotator-sidebar-empty')).toBeNull();
    expect(byTestId('annotator-sidebar-count')?.textContent).toContain('2');
  });

  it('sends the search box text to the store', () => {
    const setSearch = spyOn(store, 'setSearch').and.callThrough();
    const input = byTestId('annotator-sidebar-search') as HTMLInputElement;

    input.value = 'needle';
    input.dispatchEvent(new Event('input'));

    expect(setSearch).toHaveBeenCalledOnceWith('needle');
  });

  it('keeps the annotation when the delete confirm is declined, removes it when accepted', () => {
    addCommented(10);
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

    cards()[0].deleteRequested.emit();
    expect(store.annotations().length).toBe(1);

    confirmSpy.and.returnValue(true);
    cards()[0].deleteRequested.emit();
    expect(store.annotations().length).toBe(0);
  });

  it('emits annotationFocused with the annotation of the card', () => {
    const annotation = addCommented(10);
    const focused = jasmine.createSpy('annotationFocused');
    fixture.componentInstance.annotationFocused.subscribe(focused);

    cards()[0].focusRequested.emit();

    expect(focused).toHaveBeenCalledOnceWith(annotation);
  });

  it('forwards the card edit, save, cancel and colour outputs to the store', () => {
    const annotation = addCommented(10);
    const card = cards()[0];

    card.editRequested.emit();
    expect(store.editingId()).toBe(annotation.id);

    card.commentSaved.emit('new text');
    expect(store.editingId()).toBeNull();
    expect(store.annotations()[0].comment).toBe('new text');

    store.startEditing(annotation.id);
    card.editCancelled.emit();
    expect(store.editingId()).toBeNull();

    card.colorChanged.emit('#64b5f6');
    expect(store.annotations()[0].color).toBe('#64b5f6');
  });

  it('is as wide as the sidebar width service says', () => {
    TestBed.inject(SidebarWidthService).setWidth(450);
    fixture.detectChanges();

    expect(byTestId('annotator-sidebar')?.style.width).toBe('450px');
  });
});
