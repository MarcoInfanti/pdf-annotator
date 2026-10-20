import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';

import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { InlineTranslateLoader } from '../../shared/inline-translate-loader/inline-translate-loader';
import { LanguageService } from './language.service';

const KEY = 'pdf-annotations.language';

describe('LanguageService', () => {
  let originalLang: string;
  let originalTitle: string;

  function create(browserLanguage = 'es-ES'): LanguageService {
    spyOnProperty(Navigator.prototype, 'language', 'get').and.returnValue(browserLanguage);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService({ loader: provideTranslateLoader(InlineTranslateLoader) }),
      ],
    });
    const service = TestBed.inject(LanguageService);
    service.initialize();
    return service;
  }

  beforeEach(() => {
    originalLang = document.documentElement.lang;
    originalTitle = document.title;
    localStorage.removeItem(KEY);
  });

  afterEach(() => {
    document.documentElement.lang = originalLang;
    document.title = originalTitle;
    localStorage.removeItem(KEY);
  });

  it('prefers the stored language over the browser', () => {
    localStorage.setItem(KEY, 'en');

    expect(create('es-ES').current()).toBe('en');
  });

  it('uses Spanish for es and es-ES browsers', () => {
    expect(create('es-ES').current()).toBe('es');
  });

  it('uses Spanish for a bare es browser', () => {
    expect(create('es').current()).toBe('es');
  });

  it('uses English for en-US and any other browser language', () => {
    expect(create('en-US').current()).toBe('en');
  });

  it('uses English for a language we do not translate', () => {
    expect(create('fr-FR').current()).toBe('en');
  });

  it('ignores an invalid stored value', () => {
    localStorage.setItem(KEY, 'klingon');

    expect(create('en-US').current()).toBe('en');
  });

  it('persists the choice, sets html lang and the document title', () => {
    const service = create('es-ES');

    service.setLanguage('en');

    expect(service.current()).toBe('en');
    expect(localStorage.getItem(KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(TestBed.inject(Title).getTitle()).toBe(en.APP.TITLE);
  });

  it('sets the Spanish title on initialize', () => {
    create('es-ES');

    expect(document.title).toBe(es.APP.TITLE);
  });

  it('still switches when storage throws', () => {
    const service = create('es-ES');
    spyOn(Storage.prototype, 'setItem').and.throwError('denied');

    service.setLanguage('en');

    expect(service.current()).toBe('en');
  });
});
