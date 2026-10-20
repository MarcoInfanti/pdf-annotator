import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  bundle,
  commentOn,
  foreignStringsOnScreen,
  highlightLines,
  installFileSystem,
  openApp,
  rawKeysOnScreen,
} from './fixtures/app-helpers';
import { centreOf, drag, lineSpan, pageAt } from './fixtures/pdf-page-helpers';
import { buildSelectionFixture } from './fixtures/selection-fixture';

const LANGUAGE_KEY = 'pdf-annotations.language';

type Lang = 'es' | 'en';

/** Asserts nothing on screen is a raw key or a string of the other language. */
async function expectFullyTranslated(page: Page, lang: Lang): Promise<void> {
  expect(await rawKeysOnScreen(page)).toEqual([]);
  expect(await foreignStringsOnScreen(page, lang)).toEqual([]);
}

/** Walks the UI through its states, running `check` in each. */
async function walkEveryState(page: Page, check: () => Promise<void>): Promise<void> {
  await check(); // loaded document, empty sidebar
  const start = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
  const end = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  await drag(page, start, end);
  await expect(page.getByTestId('highlight-popup')).toBeVisible();
  await check(); // highlight popup
  await page.getByTestId('highlight-popup-color-green').click();
  await check(); // card in write mode
  await page.getByTestId('annotation-card-tab-preview').click();
  await check(); // card in preview mode ("no comment" placeholder)
  await page.getByTestId('annotation-card-tab-write').click();
  await commentOn(page, '**bold** note');
  await check(); // saved comment, dirty indicator
  await page.getByTestId('annotator-sidebar-search').fill('zzz-nothing');
  await check(); // "no match" message
  await page.getByTestId('annotator-sidebar-search').fill('');
  await page.getByTestId('annotator-toolbar-save').click();
  await expect(page.getByTestId('annotator-notice')).toBeVisible();
  await check(); // "saved in" notice
}

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });

  test('the empty state renders in English with no raw keys and no Spanish', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('annotator-empty-open')).toHaveText('Open PDF');
    await expectFullyTranslated(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('PDF Annotator');
  });

  test('every state of the loaded app is fully English', async ({ page }) => {
    await openApp(page);
    await walkEveryState(page, () => expectFullyTranslated(page, 'en'));
  });

  test('parameterised keys render their values', async ({ page }) => {
    await openApp(page, { name: 'My Book.pdf' });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    const card = page.getByTestId(/^annotation-card-[0-9a-f-]{36}$/);
    await expect(card.getByTestId('annotation-card-page')).toHaveText('P. 1');
    await expect(card.getByTestId('annotation-card-page')).toHaveAttribute(
      'aria-label',
      'Go to page 1',
    );
    await expect(page.getByTestId('pdf-page-2')).toHaveAttribute('aria-label', 'Page 2');
    await commentOn(page, 'x');
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(page.getByTestId('annotator-notice')).toHaveText(/Saved to My Book\.pdf/);
    await expect(page.getByTestId('annotator-notice')).not.toContainText('{{');
    await expect(page.getByTestId('annotator-toolbar-reading-mode-night')).toHaveAttribute(
      'title',
      'Reading mode: Night',
    );
  });

  test('the highlight popup colours are named in English', async ({ page }) => {
    await openApp(page);
    const start = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
    const end = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
    await drag(page, start, end);
    await expect(page.getByTestId('highlight-popup-color-blue')).toHaveAttribute(
      'aria-label',
      'Highlight in Blue',
    );
    await expect(page.getByTestId('highlight-popup-color-blue')).toHaveAttribute('title', 'Blue');
  });

  test('the save button title is translated, not the raw key', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('annotator-toolbar-save')).toHaveAttribute(
      'title',
      'Saves the annotations inside the same PDF (Ctrl+S)',
    );
  });

  test('the save button title is translated for a browser without file handles', async ({
    page,
  }) => {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-open').click();
    await (
      await chooser
    ).setFiles({
      name: 'a.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await buildSelectionFixture()),
    });
    await expect(page.getByTestId('annotator-toolbar-save')).toHaveAttribute(
      'title',
      'Downloads the PDF with the annotations (Ctrl+S)',
    );
  });

  test('the discard-changes confirm is in English', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-toolbar-open').click();
    expect(message).toBe(bundle('en')['CONFIRM.DISCARD_CHANGES']);
  });

  test('the delete confirm is in English', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByTestId('annotation-card-delete').click();
    expect(message).toBe(bundle('en')['CONFIRM.DELETE_ANNOTATION']);
  });

  test('the inserted table skeleton uses English headers', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotation-card-insert-table').click();
    await expect(page.getByTestId('annotation-card-editor')).toHaveValue(
      /\| Column 1 \| Column 2 \|/,
    );
  });
});

test.describe('language selection from the browser', () => {
  const cases: { locale: string; expected: Lang }[] = [
    { locale: 'es-ES', expected: 'es' },
    { locale: 'es-419', expected: 'es' },
    { locale: 'es-MX', expected: 'es' },
    { locale: 'es', expected: 'es' },
    { locale: 'en-GB', expected: 'en' },
    { locale: 'en-US', expected: 'en' },
    { locale: 'fr-FR', expected: 'en' },
    { locale: 'pt-BR', expected: 'en' },
    { locale: 'de-DE', expected: 'en' },
    { locale: 'zh-CN', expected: 'en' },
  ];
  for (const { locale, expected } of cases) {
    test.describe(locale, () => {
      test.use({ locale });

      test(`resolves to ${expected}: html lang, title and toolbar follow`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', expected);
        await expect(page).toHaveTitle(bundle(expected)['APP.TITLE']);
        await expect(page.getByTestId('annotator-empty-open')).toHaveText(
          bundle(expected)['TOOLBAR.OPEN'],
        );
        await expect(page.getByTestId(`language-switcher-${expected}`)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        const other: Lang = expected === 'es' ? 'en' : 'es';
        await expect(page.getByTestId(`language-switcher-${other}`)).toHaveAttribute(
          'aria-pressed',
          'false',
        );
        // detecting a language is not choosing one: nothing is stored until the user picks
        expect(await page.evaluate((key) => localStorage.getItem(key), LANGUAGE_KEY)).toBeNull();
      });
    });
  }
});

test.describe('Spanish browser', () => {
  test.use({ locale: 'es-ES' });

  test('every state of the loaded app is fully Spanish', async ({ page }) => {
    await openApp(page);
    await walkEveryState(page, () => expectFullyTranslated(page, 'es'));
  });

  test('the save button title is translated', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('annotator-toolbar-save')).toHaveAttribute(
      'title',
      bundle('es')['TOOLBAR.SAVE_TITLE_OVERWRITE'],
    );
  });
});

test.describe('language switcher', () => {
  test.use({ locale: 'es-ES' });

  test('switching updates text, html lang and title at once, and reverts', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('language-switcher-en').click();
    await expect(page.getByTestId('annotator-empty-open')).toHaveText('Open PDF');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('PDF Annotator');
    await expectFullyTranslated(page, 'en');
    await page.getByTestId('language-switcher-es').click();
    await expect(page.getByTestId('annotator-empty-open')).toHaveText(bundle('es')['TOOLBAR.OPEN']);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(bundle('es')['APP.TITLE']);
  });

  test('clicking the already active language is harmless', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('language-switcher-es').click();
    await page.getByTestId('language-switcher-es').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expectFullyTranslated(page, 'es');
  });

  test('the switcher labels are translated in both languages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('language-switcher')).toHaveAttribute(
      'aria-label',
      bundle('es')['LANGUAGE.LABEL'],
    );
    await expect(page.getByTestId('language-switcher-en')).toHaveAttribute(
      'aria-label',
      bundle('es')['LANGUAGE.EN'],
    );
    await page.getByTestId('language-switcher-en').click();
    await expect(page.getByTestId('language-switcher')).toHaveAttribute('aria-label', 'Language');
    await expect(page.getByTestId('language-switcher-es')).toHaveAttribute(
      'aria-label',
      bundle('en')['LANGUAGE.ES'],
    );
  });

  test('the choice survives a reload and beats the browser language', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('language-switcher-en').click();
    expect(await page.evaluate((key) => localStorage.getItem(key), LANGUAGE_KEY)).toBe('en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('annotator-empty-open')).toHaveText('Open PDF');
    await expect(page).toHaveTitle('PDF Annotator');
  });

  test('a stored language the app does not support is ignored', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => localStorage.setItem(key, 'fr'), LANGUAGE_KEY);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByTestId('annotator-empty-open')).toHaveText(bundle('es')['TOOLBAR.OPEN']);
  });

  test('a stored language with a different case is ignored, not crashed on', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => localStorage.setItem(key, 'EN'), LANGUAGE_KEY);
    await page.reload();
    await expect(page.getByTestId('annotator-empty-open')).toBeVisible();
    await expectFullyTranslated(page, 'es');
  });

  test('the switcher is available with a document open and keeps the document', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'keep me');
    await page.getByTestId('language-switcher-en').click();
    await expect(page.getByTestId('annotator-toolbar-save')).toHaveText('Save');
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('1');
    await expect(page.getByTestId('annotation-card-comment')).toContainText('keep me');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();
    await expect(page.getByTestId('pdf-page-1')).toHaveAttribute('aria-label', 'Page 1');
    await expectFullyTranslated(page, 'en');
  });

  test('switching while a notice is visible re-translates it, parameters included', async ({
    page,
  }) => {
    await openApp(page, { name: 'libro.pdf' });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotator-toolbar-save').click();
    const notice = page.getByTestId('annotator-notice');
    await expect(notice).toContainText('libro.pdf');
    await expect(notice).toContainText('Guardado');
    await page.getByTestId('language-switcher-en').click();
    await expect(notice).toContainText('Saved to libro.pdf');
    await expect(notice).not.toContainText('Guardado');
    await page.getByTestId('language-switcher-es').click();
    await expect(notice).toContainText('Guardado');
    await expect(notice).toContainText('libro.pdf');
  });

  test('switching while a validation error notice is visible re-translates it', async ({
    page,
  }) => {
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"version": 99}'),
    });
    const notice = page.getByTestId('annotator-notice');
    await expect(notice).toContainText(bundle('es')['ERRORS.UNRECOGNIZED_FORMAT']);
    await page.getByTestId('language-switcher-en').click();
    await expect(notice).toContainText(bundle('en')['ERRORS.UNRECOGNIZED_FORMAT']);
  });

  test('the notice dismiss button is named in the active language', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('annotator-toolbar-save').click();
    const dismiss = page.getByTestId('annotator-notice-dismiss');
    await expect(dismiss).toHaveAttribute('aria-label', bundle('es')['NOTICE.DISMISS']);
    await page.getByTestId('language-switcher-en').click();
    await expect(dismiss).toHaveAttribute('aria-label', 'Dismiss notice');
  });

  test('language switching with a card editor open keeps the typed text', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotation-card-editor').fill('half written');
    await page.getByTestId('language-switcher-en').click();
    await expect(page.getByTestId('annotation-card-editor')).toHaveValue('half written');
    await expect(page.getByTestId('annotation-card-editor')).toHaveAttribute(
      'placeholder',
      bundle('en')['CARD.EDITOR_PLACEHOLDER'],
    );
  });

  test('the Spanish table skeleton uses Spanish headers', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotation-card-insert-table').click();
    await expect(page.getByTestId('annotation-card-editor')).toHaveValue(
      new RegExp(bundle('es')['CARD.TABLE_COLUMN_1']),
    );
  });

  test('file names written by the app stay untranslated in English', async ({ page }) => {
    await openApp(page, { name: 'doc.pdf' });
    await page.getByTestId('language-switcher-en').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save-copy').click();
    expect((await download).suggestedFilename()).toBe('doc-anotado.pdf');
  });
});
