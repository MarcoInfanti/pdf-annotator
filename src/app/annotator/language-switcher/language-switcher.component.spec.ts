import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';

import { LanguageService } from '../../services/layout/language.service';
import { missingTranslationKeys } from '../testing/translation-keys/translation-keys';
import { LanguageSwitcherComponent } from './language-switcher.component';

describe('LanguageSwitcherComponent', () => {
  let fixture: ComponentFixture<LanguageSwitcherComponent>;
  let language: LanguageService;
  let originalLang: string;

  function button(lang: string): HTMLButtonElement {
    const found = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      `[data-testid="language-switcher-${lang}"]`,
    );
    if (!found) throw new Error(`no switcher button for ${lang}`);
    return found;
  }

  beforeEach(() => {
    originalLang = document.documentElement.lang;
    TestBed.configureTestingModule({
      imports: [LanguageSwitcherComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    language = TestBed.inject(LanguageService);
    fixture = TestBed.createComponent(LanguageSwitcherComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.documentElement.lang = originalLang;
    localStorage.removeItem('pdf-annotations.language');
  });

  it('renders one button per language, each carrying its lang', () => {
    expect(button('es').getAttribute('lang')).toBe('es');
    expect(button('en').getAttribute('lang')).toBe('en');
  });

  it('marks the active language as pressed', () => {
    language.setLanguage('en');
    fixture.detectChanges();

    expect(button('en').getAttribute('aria-pressed')).toBe('true');
    expect(button('es').getAttribute('aria-pressed')).toBe('false');
  });

  it('asks the service to switch when a button is clicked', () => {
    const setLanguage = spyOn(language, 'setLanguage');

    button('en').click();

    expect(setLanguage).toHaveBeenCalledOnceWith('en');
  });

  it('only uses translation keys that exist in both bundles', () => {
    const keys = [
      'LANGUAGE.LABEL',
      'LANGUAGE.ES',
      'LANGUAGE.EN',
      'LANGUAGE.ES_SHORT',
      'LANGUAGE.EN_SHORT',
    ];

    expect(missingTranslationKeys(keys)).toEqual([]);
  });
});
