import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PDFDocument, PDFString } from 'pdf-lib';
import {
  bundle,
  commentOn,
  highlightLines,
  installFileSystem,
  openApp,
  setFs,
} from './fixtures/app-helpers';
import { annotationJson } from './fixtures/pdf-builders';
import { buildSelectionFixture } from './fixtures/selection-fixture';

type Lang = 'es' | 'en';

const RAW_KEY = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\.[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b/;

/**
 * Independent of `collectUiStrings`: every attribute of every element except the ones that
 * legitimately hold identifiers, plus all text nodes and the document title.
 */
async function everyStringInDom(page: Page): Promise<{ where: string; value: string }[]> {
  return page.evaluate(() => {
    const skip = new Set(['class', 'id', 'style', 'for', 'name', 'href', 'src', 'type', 'role']);
    const out: { where: string; value: string }[] = [{ where: 'title', value: document.title }];
    for (const el of Array.from(document.documentElement.querySelectorAll('*'))) {
      if (el.closest('.textLayer')) continue;
      for (const attr of Array.from(el.attributes)) {
        if (skip.has(attr.name) || attr.name.startsWith('data-') || attr.name.startsWith('ng-')) {
          continue;
        }
        out.push({ where: `${el.tagName.toLowerCase()}[${attr.name}]`, value: attr.value });
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text && !node.parentElement?.closest('.textLayer')) {
        out.push({ where: 'text', value: text });
      }
    }
    return out;
  });
}

/** Asserts no string is a raw key or text that exists only in the other language's bundle. */
async function expectClean(page: Page, shown: Lang): Promise<void> {
  // zoneless rendering is asynchronous: poll until the DOM settles instead of reading once
  await expect.poll(() => problemsInDom(page, shown), { timeout: 5000 }).toEqual([]);
}

/** Raw keys and other-language strings currently in the DOM. */
async function problemsInDom(page: Page, shown: Lang): Promise<string[]> {
  const strings = await everyStringInDom(page);
  const raw = strings
    .filter(({ value }) => RAW_KEY.test(value))
    .map(({ where, value }) => `raw ${where}: ${value}`);
  const ownBundle = bundle(shown);
  const own = Object.values(ownBundle);
  const other = bundle(shown === 'es' ? 'en' : 'es');
  const foreign = Object.entries(other)
    .filter(
      ([key, value]) => value !== ownBundle[key] && !value.includes('{{') && value.length >= 4,
    )
    .filter(([, value]) => !own.some((text) => text.includes(value)));
  const joined = strings.map(({ value }) => value);
  const wrongLanguage = foreign
    .filter(([, value]) => joined.some((s) => s.includes(value)))
    .map(([key]) => `foreign ${key}`);
  return [...raw, ...wrongLanguage];
}

async function encryptedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([360, 200]);
  const dictionary = doc.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    O: PDFString.of('0'.repeat(32)),
    U: PDFString.of('0'.repeat(32)),
    P: -4,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(dictionary);
  return Buffer.from(await doc.save());
}

/** Visits the states the main walk does not: zoom, fit, reading modes, import error. */
async function walkExtraStates(page: Page, check: () => Promise<void>): Promise<void> {
  await highlightLines(page, 'ALPHA', 'BRAVO');
  await check(); // card open on a fresh highlight
  await commentOn(page, 'hello');
  await check(); // dirty indicator, saved comment
  await page.getByTestId('annotator-toolbar-zoom-in').click();
  await check();
  await page.getByTestId('annotator-toolbar-fit-width').click();
  await check();
  for (const mode of ['night', 'sepia', 'normal']) {
    await page.getByTestId(`annotator-toolbar-reading-mode-${mode}`).click();
    await check();
  }
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('annotator-toolbar-import-json').click();
  await (
    await chooser
  ).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"v": 99}') });
  await expect(page.getByTestId('annotator-notice')).toBeVisible();
  await check(); // validation-error notice
  await page.getByTestId('annotator-notice-dismiss').click();
  await check();
}

for (const [locale, lang, other] of [
  ['es-ES', 'es', 'en'],
  ['en-US', 'en', 'es'],
] as const) {
  test.describe(`DOM audit in ${lang}`, () => {
    test.use({ locale });

    test('empty state is clean, also after switching language and back', async ({ page }) => {
      await page.goto('/');
      await expectClean(page, lang);
      await page.getByTestId(`language-switcher-${other}`).click();
      await expectClean(page, other);
      await page.getByTestId(`language-switcher-${lang}`).click();
      await expectClean(page, lang);
    });

    test('loaded document: extra states stay clean, then after switching language', async ({
      page,
    }) => {
      await openApp(page);
      await walkExtraStates(page, () => expectClean(page, lang));
      await page.getByTestId(`language-switcher-${other}`).click();
      await expectClean(page, other);
    });

    test('the encrypted-PDF notice path is clean, before and after switching', async ({ page }) => {
      await installFileSystem(page, { handle: false });
      await page.goto('/');
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('annotator-toolbar-open').click();
      await (
        await chooser
      ).setFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: await encryptedPdf() });
      await expect(page.getByTestId('annotator-notice')).toBeVisible();
      await expectClean(page, lang);
      await page.getByTestId(`language-switcher-${other}`).click();
      await expectClean(page, other);
      await expect(page.getByTestId('annotator-notice')).toContainText(
        bundle(other)['NOTICE.ENCRYPTED'].slice(0, 20),
      );
    });

    test('a file that is not a PDF shows a translated notice, not a raw key', async ({ page }) => {
      await installFileSystem(page, { handle: false });
      await page.goto('/');
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('annotator-toolbar-open').click();
      await (
        await chooser
      ).setFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
      await expect(page.getByTestId('annotator-notice')).toBeVisible();
      await expectClean(page, lang);
    });

    test('every autosave state, the toggle and both offer bars are clean and labelled', async ({
      page,
    }) => {
      const texts = bundle(lang);
      const position = {
        page: 2,
        x: 0,
        y: 100,
        zoom: 1,
        updatedAt: '2026-03-01T10:00:00.000Z',
      };
      const copy = {
        baseline: { size: 1, lastModified: 1 },
        annotations: annotationJson('99999999-9999-4999-8999-999999999999', 'unsaved note'),
      };
      await openApp(page, {
        autosave: true,
        permission: { query: 'prompt', request: 'denied' },
        storage: {
          'pdf-annotations.position.fixture.pdf|2': JSON.stringify(position),
          'pdf-annotations.recovery.fixture.pdf|2': JSON.stringify(copy),
        },
      });
      await expect(page.getByTestId('annotator-resume')).toBeVisible();
      await expectClean(page, lang); // idle, with both bars open
      await expect(page.getByTestId('annotator-toolbar-autosave')).toHaveAttribute(
        'title',
        texts['TOOLBAR.AUTOSAVE_TITLE_ON'],
      );
      await expect(page.locator('#annotator-recovery-label')).toHaveText(texts['NOTICE.RECOVERY']);
      await expect(page.getByTestId('annotator-recovery-restore')).toHaveText(
        texts['NOTICE.RECOVERY_ACTION'],
      );
      for (const bar of ['resume', 'recovery']) {
        const group = page.getByTestId(`annotator-${bar}`);
        await expect(group).toHaveAttribute('role', 'group');
        await expect(group).toHaveAttribute('aria-labelledby', `annotator-${bar}-label`);
        await expect(page.getByTestId(`annotator-${bar}-dismiss`)).toHaveAttribute(
          'aria-label',
          texts[`NOTICE.${bar.toUpperCase()}_DISMISS`],
        );
      }
      await expect(page.locator('#annotator-resume-label')).toHaveText(
        texts['NOTICE.RESUME'].replace('{{page}}', '2'),
      );

      // the first change asks for write access; the denial pauses autosave
      await highlightLines(page, 'ALPHA', 'BRAVO');
      await expect(page.getByTestId('annotator-toolbar-autosave-paused')).toHaveText(
        texts['TOOLBAR.AUTOSAVE_PAUSED'],
      );
      await expect(page.getByTestId('annotator-toolbar-autosave-paused')).toHaveAttribute(
        'title',
        texts['TOOLBAR.AUTOSAVE_PAUSED_TITLE'],
      );
      await expectClean(page, lang);

      await page.getByTestId('annotator-toolbar-save').click(); // denied again
      await expect(page.getByTestId('annotator-notice')).toContainText(
        texts['NOTICE.PERMISSION_DENIED'].slice(0, 25),
      );
      await expectClean(page, lang);

      await setFs(page, { request: 'granted' });
      await page.getByTestId('annotator-toolbar-save').click();
      await expect(page.getByTestId('annotator-toolbar-saved')).toHaveText(
        `✓ ${texts['TOOLBAR.SAVED']}`,
      );
      await expectClean(page, lang);
      await highlightLines(page, 'ALPHA', 'BRAVO');
      await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();
      await expectClean(page, lang);
      await page.getByTestId('annotator-toolbar-autosave').click();
      await expect(page.getByTestId('annotator-toolbar-autosave')).toHaveAttribute(
        'title',
        texts['TOOLBAR.AUTOSAVE_TITLE_OFF'],
      );
      await expectClean(page, lang);
      await page.getByTestId(`language-switcher-${other}`).click();
      await expectClean(page, other);
      await expect(page.getByTestId('annotator-toolbar-autosave')).toHaveAttribute(
        'title',
        bundle(other)['TOOLBAR.AUTOSAVE_TITLE_OFF'],
      );
    });

    test('the import-retry notice is translated, not a raw key', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userActivation', {
          configurable: true,
          get: () => ({ isActive: false, hasBeenActive: true }),
        });
      });
      await openApp(page, { autosave: false });
      await page.getByTestId('annotator-toolbar-import-json').click();
      await expect(page.getByTestId('annotator-notice')).toHaveText(
        new RegExp(bundle(lang)['NOTICE.IMPORT_RETRY'].slice(0, 12)),
      );
      await expectClean(page, lang);
    });

    test('the saving state and the disabled toggle are clean', async ({ page }) => {
      await page.clock.install();
      await openApp(page, { autosave: true, writeDelayMs: 4000 });
      await highlightLines(page, 'ALPHA', 'BRAVO');
      await page.getByTestId('annotation-card-cancel').click();
      await page.clock.runFor(3500);
      await expect(page.getByTestId('annotator-toolbar-saving')).toHaveText(
        bundle(lang)['TOOLBAR.SAVING'],
      );
      await expectClean(page, lang);
    });

    test('the unavailable toggle title is clean for a browser without file handles', async ({
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
      await expect(page.getByTestId('annotator-toolbar-autosave')).toBeDisabled();
      await expect(page.getByTestId('annotator-toolbar-autosave')).toHaveAttribute(
        'title',
        bundle(lang)['TOOLBAR.AUTOSAVE_UNAVAILABLE'],
      );
      await expectClean(page, lang);
    });
  });
}

test.describe('sidebar width versus the viewport', () => {
  const KEY = 'pdf-annotations.sidebar-width';

  async function reading(page: Page): Promise<{ width: number; now: number; max: number }> {
    const sep = page.getByTestId('sidebar-resizer');
    const box = await page.getByTestId('annotator-sidebar').boundingBox();
    return {
      width: Math.round(box?.width ?? 0),
      now: Number(await sep.getAttribute('aria-valuenow')),
      max: Number(await sep.getAttribute('aria-valuemax')),
    };
  }

  // The project viewport is 1280 wide, so the maximum is 896.
  for (const [stored, expected] of [
    ['896', 896],
    ['897', 896],
    ['900.4', 896],
    ['300.6', 301],
    ['260', 260],
    ['259.9', 380],
    ['-300', 380],
    ['NaN', 380],
    ['Infinity', 896],
    ['1e9', 896],
    [' 400 ', 400],
    ['0x190', 400],
  ] as const) {
    test(`stored "${stored}" opens at ${expected}px with aria-valuenow within aria-valuemax`, async ({
      page,
    }) => {
      await page.addInitScript(
        ([key, value]) => {
          if (!sessionStorage.getItem('seeded')) {
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem(key, value);
          }
        },
        [KEY, stored],
      );
      await openApp(page);
      await expect.poll(async () => (await reading(page)).width).toBe(expected);
      const r = await reading(page);
      expect(r.now).toBeLessThanOrEqual(r.max);
      expect(r.width).toBeLessThanOrEqual(r.max);
    });
  }

  test('a viewport whose 70 % is below the minimum still keeps the sidebar within 70 %', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 300, height: 700 });
    await page.addInitScript((key) => localStorage.setItem(key, '500'), KEY);
    await installFileSystem(page);
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-sidebar')).toBeVisible();
    const r = await reading(page);
    expect(r.max).toBe(210);
    expect(r.width).toBeLessThanOrEqual(r.max);
    expect(r.now).toBeLessThanOrEqual(r.max);
  });

  test('a viewport shrunk after load keeps the sidebar within 70 % of it', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '800'), KEY);
    await openApp(page);
    await expect.poll(async () => (await reading(page)).width).toBe(800);
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForTimeout(300);
    const r = await reading(page);
    // 70 % of the new 800px viewport, whatever the separator still advertises
    expect(r.width).toBeLessThanOrEqual(Math.round(800 * 0.7));
    expect(r.max).toBe(560);
    expect(r.now).toBeLessThanOrEqual(r.max);
  });
});
