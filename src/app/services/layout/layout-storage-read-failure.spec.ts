import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';

import { InlineTranslateLoader } from '../../shared/inline-translate-loader/inline-translate-loader';
import { LanguageService } from './language.service';
import { ReadingModeService } from './reading-mode.service';
import { SidebarWidthService } from './sidebar-width.service';

/** Reading from storage can throw too (blocked cookies, sandboxed iframes), not only writing. */
describe('layout services when localStorage cannot be read', () => {
  let originalLang: string;
  let originalTitle: string;

  beforeEach(() => {
    originalLang = document.documentElement.lang;
    originalTitle = document.title;
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(InlineTranslateLoader) }),
      ],
    });
  });

  afterEach(() => {
    document.documentElement.lang = originalLang;
    document.title = originalTitle;
    document.documentElement.removeAttribute('data-theme');
  });

  it('SidebarWidthService starts at the default width', () => {
    const width = TestBed.inject(SidebarWidthService);

    expect(width.width()).toBe(380);
  });

  it('ReadingModeService starts in normal mode', () => {
    const reading = TestBed.inject(ReadingModeService);
    TestBed.tick();

    expect(reading.mode()).toBe('normal');
    expect(document.documentElement.hasAttribute('data-theme')).toBeFalse();
  });

  it('LanguageService falls back to the browser language and still sets html lang and title', () => {
    spyOnProperty(Navigator.prototype, 'language', 'get').and.returnValue('en-GB');
    const language = TestBed.inject(LanguageService);

    language.initialize();

    expect(language.current()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(TestBed.inject(Title).getTitle()).toBe('PDF Annotator');
  });
});

describe('SidebarWidthService with a stored width beyond what the viewport allows', () => {
  const KEY = 'pdf-annotations.sidebar-width';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => localStorage.removeItem(KEY));

  it('clamps a stored width larger than the maximum instead of trusting it', () => {
    localStorage.setItem(KEY, '5000');
    const width = TestBed.inject(SidebarWidthService);

    expect(width.width()).toBeLessThanOrEqual(width.maxWidth());
  });

  it('keeps a stored width that is within bounds exactly', () => {
    localStorage.setItem(KEY, '300');
    const width = TestBed.inject(SidebarWidthService);

    expect(width.width()).toBe(300);
  });
});
