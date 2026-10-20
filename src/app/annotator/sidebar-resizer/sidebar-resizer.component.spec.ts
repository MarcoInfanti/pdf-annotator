import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { SidebarWidthService } from '../../services/layout/sidebar-width.service';
import { missingTranslationKeys } from '../testing/translation-keys/translation-keys';
import { SidebarResizerComponent } from './sidebar-resizer.component';

const STORAGE_KEY = 'pdf-annotations.sidebar-width';

describe('SidebarResizerComponent', () => {
  let fixture: ComponentFixture<SidebarResizerComponent>;
  let width: SidebarWidthService;
  let separator: HTMLElement;

  function press(key: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    separator.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SidebarResizerComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    width = TestBed.inject(SidebarWidthService);
    fixture = TestBed.createComponent(SidebarResizerComponent);
    fixture.detectChanges();
    separator = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="sidebar-resizer"]',
    )!;
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('widens by 20 with ArrowLeft and by 80 with Shift+ArrowLeft, preventing the default', () => {
    const plain = press('ArrowLeft');
    expect(width.width()).toBe(400);
    expect(plain.defaultPrevented).toBeTrue();

    const shifted = press('ArrowLeft', true);
    expect(width.width()).toBe(480);
    expect(shifted.defaultPrevented).toBeTrue();
  });

  it('narrows by 20 with ArrowRight, preventing the default', () => {
    const event = press('ArrowRight');

    expect(width.width()).toBe(360);
    expect(event.defaultPrevented).toBeTrue();
  });

  it('ignores other keys', () => {
    const event = press('Enter');

    expect(width.width()).toBe(380);
    expect(event.defaultPrevented).toBeFalse();
  });

  it('resets to 380 on double click', () => {
    width.setWidth(500);

    separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(width.width()).toBe(380);
  });

  it('reflects the service in its aria value attributes', () => {
    width.setWidth(420);
    fixture.detectChanges();

    expect(separator.getAttribute('aria-valuenow')).toBe('420');
    expect(separator.getAttribute('aria-valuemin')).toBe(String(width.minWidth));
    expect(separator.getAttribute('aria-valuemax')).toBe(String(width.maxWidth()));
  });

  it('only uses translation keys that exist in both bundles', () => {
    const keys = ['SIDEBAR.RESIZER_LABEL', 'SIDEBAR.RESIZER_TITLE'];

    expect(missingTranslationKeys(keys)).toEqual([]);
  });
});
