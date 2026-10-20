import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { TextSelection } from '../../models/annotator.model';
import { HIGHLIGHT_COLORS } from '../annotator.data';
import { HighlightPopupComponent } from './highlight-popup.component';

const SELECTION: TextSelection = {
  page: 1,
  rects: [[0, 0, 10, 10]],
  quote: 'q',
  clientX: 120,
  clientY: 80,
};

describe('HighlightPopupComponent', () => {
  let fixture: ComponentFixture<HighlightPopupComponent>;
  let picked: jasmine.Spy<(color: string) => void>;
  let dismissed: jasmine.Spy<() => void>;

  function byTestId(id: string): HTMLElement {
    const element = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );
    if (!element) throw new Error(`No element with data-testid ${id}`);
    return element;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HighlightPopupComponent],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(HighlightPopupComponent);
    fixture.componentRef.setInput('selection', SELECTION);
    picked = jasmine.createSpy('colorPicked');
    dismissed = jasmine.createSpy('dismissed');
    fixture.componentInstance.colorPicked.subscribe(picked);
    fixture.componentInstance.dismissed.subscribe(dismissed);
    fixture.detectChanges();
  });

  it('offers one button per highlight colour', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(byTestId(`highlight-popup-color-${color.id}`)).toBeTruthy();
    }
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('button').length).toBe(4);
  });

  it('emits the hex value of the clicked colour', () => {
    byTestId('highlight-popup-color-green').click();

    expect(picked).toHaveBeenCalledOnceWith(HIGHLIGHT_COLORS[1].value);
  });

  it('is dismissed by a mousedown outside it', () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('is not dismissed by a mousedown on a colour button', () => {
    byTestId('highlight-popup-color-blue').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );

    expect(dismissed).not.toHaveBeenCalled();
  });

  it('sits at the mouse position, 12px lower', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.style.left).toBe('120px');
    expect(host.style.top).toBe('92px');
  });
});
