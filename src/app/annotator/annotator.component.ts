import { DecimalPipe } from '@angular/common';
import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { Annotation, TextSelection } from '../models/annotator.model';
import { HIGHLIGHT_COLORS } from './annotator.data';
import { AnnotationCardComponent } from './annotation-card.component';
import { AnnotatorStore } from './annotator.store';
import { PdfViewerComponent } from './pdf-viewer.component';
import { READING_MODES, ReadingModeService } from '../services/layout/reading-mode.service';

const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

const SIDEBAR_DEFAULT_WIDTH = 380;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_WIDTH_KEY = 'pdf-annotations.sidebar-width';

@Component({
  selector: 'app-annotator',
  imports: [PdfViewerComponent, AnnotationCardComponent, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotator.component.html',
  styleUrl: './annotator.component.scss',
  host: {
    '(window:keydown)': 'handleShortcuts($event)',
    '(window:beforeunload)': 'warnUnsaved($event)',
    '(document:mousedown)': 'closePopupOutside($event)',
  },
})
export class AnnotatorComponent {
  protected readonly store = inject(AnnotatorStore);
  protected readonly readingMode = inject(ReadingModeService);
  protected readonly readingModes = READING_MODES;
  private readonly viewer = viewChild(PdfViewerComponent);
  private readonly popup = viewChild<ElementRef<HTMLElement>>('popup');

  protected readonly colors = HIGHLIGHT_COLORS;
  protected readonly zoomSteps = ZOOM_STEPS;
  protected readonly scale = signal(1.25);
  protected readonly zoomPercent = computed(() => Math.round(this.scale() * 100));
  protected readonly pendingSelection = signal<TextSelection | null>(null);
  protected readonly search = signal('');
  protected readonly sidebarMinWidth = SIDEBAR_MIN_WIDTH;
  protected readonly sidebarWidth = signal(readStoredWidth());
  protected readonly resizing = signal(false);
  /** Highlights without a comment only show up while selected or being edited. */
  protected readonly listedAnnotations = computed(() => {
    const selectedId = this.store.selectedId();
    const editingId = this.store.editingId();
    return this.store
      .annotations()
      .filter((a) => a.comment || a.id === selectedId || a.id === editingId);
  });
  protected readonly commentCount = computed(
    () => this.store.annotations().filter((a) => a.comment).length,
  );
  protected readonly visibleAnnotations = computed(() => {
    const term = this.search().trim().toLowerCase();
    const listed = this.listedAnnotations();
    return term
      ? listed.filter((a) => (a.quote + ' ' + a.comment).toLowerCase().includes(term))
      : listed;
  });

  /** Moves to the next zoom step, also from a scale between steps (e.g. after "fit width"). */
  protected zoom(direction: 1 | -1): void {
    const current = this.scale();
    const next =
      direction === 1
        ? ZOOM_STEPS.find((step) => step > current + 0.001)
        : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001);
    if (next !== undefined) this.scale.set(next);
  }

  protected setZoom(scale: number): void {
    this.scale.set(Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM));
  }

  protected fitWidth(): void {
    const scale = this.viewer()?.fitWidthScale();
    if (scale) this.setZoom(scale);
  }

  protected changeZoom(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'fit') {
      this.fitWidth();
    } else {
      this.setZoom(Number(value));
    }
  }

  protected highlight(color: string): void {
    const selection = this.pendingSelection();
    if (!selection) return;
    this.store.add(selection, color);
    this.pendingSelection.set(null);
    document.getSelection()?.removeAllRanges();
  }

  protected selectFromPdf(id: string | null): void {
    this.pendingSelection.set(null);
    this.store.select(id);
  }

  protected focus(annotation: Annotation): void {
    this.store.select(annotation.id);
    this.viewer()?.scrollTo(annotation);
  }

  protected remove(annotation: Annotation): void {
    if (confirm('¿Eliminar esta anotación?')) this.store.remove(annotation.id);
  }

  protected sidebarMaxWidth(): number {
    return Math.round(window.innerWidth * 0.7);
  }

  protected setSidebarWidth(width: number): void {
    const clamped = Math.round(
      Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), this.sidebarMaxWidth()),
    );
    this.sidebarWidth.set(clamped);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
    } catch {
      // Storage unavailable (private mode): the width just isn't remembered.
    }
  }

  protected startResize(event: PointerEvent): void {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.resizing.set(true);
  }

  protected resize(event: PointerEvent): void {
    if (this.resizing()) this.setSidebarWidth(window.innerWidth - event.clientX);
  }

  protected stopResize(event: PointerEvent): void {
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    this.resizing.set(false);
  }

  protected resizeWithKeys(event: KeyboardEvent): void {
    const step = event.shiftKey ? 80 : 20;
    if (event.key === 'ArrowLeft') this.setSidebarWidth(this.sidebarWidth() + step);
    else if (event.key === 'ArrowRight') this.setSidebarWidth(this.sidebarWidth() - step);
    else return;
    event.preventDefault();
  }

  protected resetSidebarWidth(): void {
    this.setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected handleShortcuts(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.store.save();
    } else if (ctrl && this.store.document() && ['+', '=', '-', '0'].includes(event.key)) {
      // Replaces the browser zoom, which would also shrink the toolbar and sidebar.
      event.preventDefault();
      if (event.key === '0') this.setZoom(1);
      else this.zoom(event.key === '-' ? -1 : 1);
    } else if (event.key === 'Escape') {
      this.pendingSelection.set(null);
    }
  }

  protected warnUnsaved(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }

  protected closePopupOutside(event: MouseEvent): void {
    if (!this.popup()?.nativeElement.contains(event.target as Node)) {
      this.pendingSelection.set(null);
    }
  }
}

function readStoredWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored >= SIDEBAR_MIN_WIDTH ? stored : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}
