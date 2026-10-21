import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { PDFDocument, PDFString } from 'pdf-lib';
import {
  bundle,
  commentOn,
  fsState,
  highlightLines,
  installFileSystem,
  openApp,
  readStorage,
  setFs,
} from './fixtures/app-helpers';
import { boxOf, centreOf, drag, lineSpan, pageAt } from './fixtures/pdf-page-helpers';
import { buildSelectionFixture } from './fixtures/selection-fixture';

const ES = bundle('es');
const CARD = /^annotation-card-[0-9a-f-]{36}$/;
const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
/** CSS colour of each highlight colour id, as the browser reports it. */
const RGB = {
  yellow: 'rgb(255, 213, 79)',
  green: 'rgb(129, 199, 132)',
  blue: 'rgb(100, 181, 246)',
  pink: 'rgb(244, 143, 177)',
} as const;

function cards(page: Page): Locator {
  return page.getByTestId(CARD);
}

function highlights(page: Page): Locator {
  return page.locator('[data-testid^="pdf-page-highlight-"]');
}

async function pageWidth(page: Page, index = 0): Promise<number> {
  return Math.round((await boxOf(pageAt(page, index))).width);
}

async function sidebarWidth(page: Page): Promise<number> {
  return Math.round((await boxOf(page.getByTestId('annotator-sidebar'))).width);
}

/** Clicks the bottom-right corner of page 1, where there is no text and no highlight. */
async function clickPageWhitespace(page: Page): Promise<void> {
  const box = await boxOf(pageAt(page, 0));
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8);
}

/** Resolves with the message of the next dialog, answering it as asked. */
function answerNextDialog(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', (dialog) => {
      resolve(dialog.message());
      void (accept ? dialog.accept() : dialog.dismiss());
    });
  });
}

/** Opens a PDF through the `<input type=file>` fallback (browsers without file handles). */
async function openWithInput(page: Page, name: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('annotator-toolbar-open').click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer });
  await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
}

test.describe('save and reopen', () => {
  test('saving in place writes once, clears the dirty flag, and the annotations survive a reopen', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO', 'green');
    await commentOn(page, 'remember **this**');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();

    await page.getByTestId('annotator-toolbar-save').click();
    await expect(page.getByTestId('annotator-notice')).toContainText('fixture.pdf');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
    await expect(page.getByTestId('annotator-toolbar-saved')).toBeVisible();
    expect((await fsState(page)).writes).toBe(1);
    expect(Buffer.from((await fsState(page)).bytes.slice(0, 5)).toString()).toBe('%PDF-');

    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotation-card-comment')).toContainText('remember');
    await expect(page.getByTestId('annotation-card-comment').locator('strong')).toHaveText('this');
    await expect(page.getByTestId('annotation-card-quote')).toContainText('BRAVO');
    await expect(highlights(page).first()).toHaveCSS('background-color', RGB.green);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('1');
    expect(dialogs).toEqual([]); // a clean document never asks to confirm
  });

  test('Ctrl+S saves like the button and does not trigger the browser save', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
    expect((await fsState(page)).writes).toBe(1);
  });

  test('Ctrl+S with no document open does nothing and does not throw', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('annotator-empty-state')).toBeVisible();
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a failing overwrite shows an error notice, keeps the document dirty and the toolbar usable', async ({
    page,
  }) => {
    await installFileSystem(page);
    await page.addInitScript(() => {
      const w = window as unknown as {
        showOpenFilePicker: () => Promise<{ getFile: () => Promise<File> }[]>;
      };
      const original = w.showOpenFilePicker;
      w.showOpenFilePicker = async () => {
        const [handle] = await original();
        return [
          {
            getFile: () => handle.getFile(),
            createWritable: () => Promise.reject(new Error('disk full')),
          },
        ];
      };
    });
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(page.getByTestId('annotator-notice')).toContainText('disk full');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();
    await expect(page.getByTestId('annotator-toolbar-save')).toBeEnabled();
  });

  test('a rejecting handle surfaces the error and re-enables the toolbar', async ({ page }) => {
    await page.addInitScript(() => {
      const handle = {
        getFile: () => Promise.reject(new Error('permission revoked')),
      };
      Object.assign(window, { showOpenFilePicker: () => Promise.resolve([handle]) });
    });
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    const notice = page.getByTestId('annotator-notice');
    await expect(notice).toContainText('permission revoked');
    await expect(notice).toContainText(ES['NOTICE.ERROR'].split('{{')[0].trim());
    await expect(page.getByTestId('annotator-toolbar-open')).toBeEnabled();
    await expect(page.getByTestId('annotator-empty-state')).toBeVisible();
  });

  test('cancelling the picker (AbortError) is silent', async ({ page }) => {
    await page.addInitScript(() => {
      Object.assign(window, {
        showOpenFilePicker: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
      });
    });
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    await expect(page.getByTestId('annotator-empty-state')).toBeVisible();
    await expect(page.getByTestId('annotator-toolbar-open')).toBeEnabled();
  });

  test('without file handles, save downloads the same name and the download reopens with its annotations', async ({
    page,
  }) => {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    await openWithInput(page, 'plain.pdf', Buffer.from(await buildSelectionFixture()));
    await highlightLines(page, 'ALPHA', 'BRAVO', 'blue');
    await commentOn(page, 'downloaded note');

    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('plain.pdf');
    await expect(page.getByTestId('annotator-notice')).toContainText(
      ES['NOTICE.DOWNLOADED'].slice(0, 12),
    );
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
    expect(await readStorage(page, 'pdf-annotations.recovery.plain.pdf|2')).toBeNull(); // the download cleared the copy
    await expect(page.getByTestId('annotator-toolbar-save')).toHaveAttribute(
      'title',
      ES['TOOLBAR.SAVE_TITLE_DOWNLOAD'],
    );

    const path = await saved.path();
    await openWithInput(page, 'plain.pdf', readFileSync(path));
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotation-card-comment')).toContainText('downloaded note');
    await expect(highlights(page).first()).toHaveCSS('background-color', RGB.blue);
  });

  test('save copy downloads name-anotado.pdf, leaves the document dirty and keeps the open file', async ({
    page,
  }) => {
    await openApp(page, { name: 'Report.PDF' });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save-copy').click();
    expect((await download).suggestedFilename()).toBe('Report-anotado.pdf');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();
    expect((await fsState(page)).writes).toBe(0);
  });

  test('a file name with dots and no .pdf suffix keeps its full name in exports', async ({
    page,
  }) => {
    await openApp(page, { name: 'v1.2.final' });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-export-json').click();
    expect((await download).suggestedFilename()).toBe('v1.2.final.annotations.json');
  });
});

test.describe('JSON export and import', () => {
  async function exportJson(page: Page): Promise<string> {
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-export-json').click();
    return readFileSync(await (await download).path(), 'utf8');
  }

  async function importJson(page: Page, content: string): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'in.annotations.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
  }

  test('export then import into a fresh session restores the annotation; importing twice does not duplicate', async ({
    page,
  }) => {
    await openApp(page, { name: 'book.pdf' });
    await highlightLines(page, 'ALPHA', 'BRAVO', 'pink');
    await commentOn(page, 'exported');
    const json = await exportJson(page);
    const parsed = JSON.parse(json) as { version: number; annotations: { comment: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.annotations).toHaveLength(1);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(cards(page)).toHaveCount(0);

    await importJson(page, json);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();
    await importJson(page, json);
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('1');
  });

  test('an import with one known and one new id adds only the new one', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'original');
    const file = JSON.parse(await exportJson(page)) as {
      version: number;
      annotations: Record<string, unknown>[];
    };
    file.annotations.push({
      ...file.annotations[0],
      id: '11111111-2222-4333-8444-555555555555',
      quote: 'EXTRA QUOTE',
      comment: 'extra comment',
    });
    await importJson(page, JSON.stringify(file));
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('2');
  });

  test('an unrecognised format shows the translated error and keeps the annotations', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'safe');
    await importJson(page, '{"version": 2, "annotations": []}');
    await expect(page.getByTestId('annotator-notice')).toContainText(
      ES['ERRORS.UNRECOGNIZED_FORMAT'],
    );
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotator-toolbar-import-json')).toBeEnabled();
  });

  test('a non-array annotations field is rejected as unrecognised', async ({ page }) => {
    await openApp(page);
    await importJson(page, '{"version": 1, "annotations": "nope"}');
    await expect(page.getByTestId('annotator-notice')).toContainText(
      ES['ERRORS.UNRECOGNIZED_FORMAT'],
    );
  });

  test('a file that is not JSON shows an Error notice with the parser message', async ({
    page,
  }) => {
    await openApp(page);
    await importJson(page, 'this is not json');
    const notice = page.getByTestId('annotator-notice');
    await expect(notice).toContainText('Error:');
    await expect(notice).not.toContainText('{{');
    await expect(cards(page)).toHaveCount(0);
  });

  test('dismissing a notice removes it and a later notice can appear again', async ({ page }) => {
    await openApp(page);
    await importJson(page, 'nope');
    await page.getByTestId('annotator-notice-dismiss').click();
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    await importJson(page, 'nope again');
    await expect(page.getByTestId('annotator-notice')).toBeVisible();
  });

  test('exporting an empty document yields a valid empty file', async ({ page }) => {
    await openApp(page);
    const parsed = JSON.parse(await exportJson(page)) as { annotations: unknown[] };
    expect(parsed.annotations).toEqual([]);
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
  });
});

test.describe('encrypted PDF', () => {
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

  test('shows the encrypted notice, hides Save copy, and Save exports JSON instead', async ({
    page,
  }) => {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-open').click();
    await (
      await chooser
    ).setFiles({
      name: 'locked.pdf',
      mimeType: 'application/pdf',
      buffer: await encryptedPdf(),
    });
    await expect(page.getByTestId('annotator-notice')).toContainText(
      ES['NOTICE.ENCRYPTED'].slice(0, 20),
    );
    await expect(page.getByTestId('annotator-toolbar-save-copy')).toHaveCount(0);
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    expect((await download).suggestedFilename()).toBe('locked.annotations.json');
  });
});

test.describe('dirty state and confirmations', () => {
  test('the dirty indicator follows highlight, colour change, comment and delete', async ({
    page,
  }) => {
    await openApp(page);
    const dirty = page.getByTestId('annotator-toolbar-dirty');
    await expect(dirty).toHaveCount(0);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await expect(dirty).toBeVisible();
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(dirty).toHaveCount(0);
    await page.getByTestId('annotation-card-swatch-pink').click();
    await expect(dirty).toBeVisible();
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(dirty).toHaveCount(0);
    await page.getByTestId('annotation-card-cancel').click();
    await expect(dirty).toHaveCount(0); // cancelling an edit changes nothing
  });

  test('opening over unsaved changes asks first; cancelling keeps everything and does not pick', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'unsaved');
    const asked = answerNextDialog(page, false);
    await page.getByTestId('annotator-toolbar-open').click();
    expect(await asked).toBe(ES['CONFIRM.DISCARD_CHANGES']);
    expect((await fsState(page)).pickerCalls).toBe(1);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotator-toolbar-dirty')).toBeVisible();
  });

  test('accepting the discard prompt opens the file and clears the previous session', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'unsaved');
    await page.getByTestId('annotator-sidebar-search').fill('unsaved');
    const asked = answerNextDialog(page, true);
    await page.getByTestId('annotator-toolbar-open').click();
    await asked;
    await expect.poll(async () => (await fsState(page)).pickerCalls).toBe(2);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('0');
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
    await expect(highlights(page)).toHaveCount(0);
  });

  test('with autosave on, opening over a pending change picks first, saves once and asks nothing', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'pending');
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await setFs(page, { name: 'next.pdf' });
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('next.pdf');
    const state = await fsState(page);
    expect(state.pickerCalls).toBe(2);
    expect(state.writes).toBe(1);
    expect(dialogs).toEqual([]);
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
  });

  test('with autosave on and a failing save, Open picks, then asks; cancelling keeps the session and loads nothing', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'pending');
    await setFs(page, { name: 'next.pdf', failWrites: 1000 });
    const asked = answerNextDialog(page, false);
    await page.getByTestId('annotator-toolbar-open').click();
    expect(await asked).toBe(ES['CONFIRM.DISCARD_CHANGES']);
    const state = await fsState(page);
    expect(state.pickerCalls).toBe(2);
    expect(state.writes).toBe(0);
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('fixture.pdf');
    await expect(page.getByTestId('annotator-toolbar-file-name')).not.toContainText('next.pdf');
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotator-toolbar-open')).toBeEnabled();

    // accepting the same prompt does replace the session
    const askedAgain = answerNextDialog(page, true);
    await page.getByTestId('annotator-toolbar-open').click();
    await askedAgain;
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('next.pdf');
    await expect(cards(page)).toHaveCount(0);
  });

  test('the empty-state open button never asks for confirmation', async ({ page }) => {
    await installFileSystem(page);
    await page.goto('/');
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-empty-open').click();
    await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  /** Fires a cancelable beforeunload on window; true when the app asked to block the unload. */
  function unloadIsBlocked(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  }

  test('a dirty document blocks unload', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    expect(await unloadIsBlocked(page)).toBe(true);
  });

  test('a clean document does not block unload', async ({ page }) => {
    await openApp(page);
    expect(await unloadIsBlocked(page)).toBe(false);
  });

  test('with no document open nothing blocks unload', async ({ page }) => {
    await page.goto('/');
    expect(await unloadIsBlocked(page)).toBe(false);
  });

  test('a saved document no longer blocks unload', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
    expect(await unloadIsBlocked(page)).toBe(false);
  });

  test('delete asks first: dismissing keeps the card, accepting removes card and highlight', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'to delete');
    const kept = answerNextDialog(page, false);
    await page.getByTestId('annotation-card-delete').click();
    expect(await kept).toBe(ES['CONFIRM.DELETE_ANNOTATION']);
    await expect(cards(page)).toHaveCount(1);
    await expect(highlights(page).first()).toBeVisible();

    const gone = answerNextDialog(page, true);
    await page.getByTestId('annotation-card-delete').click();
    await gone;
    await expect(cards(page)).toHaveCount(0);
    await expect(highlights(page)).toHaveCount(0);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('0');
    await expect(page.getByTestId('annotator-sidebar-empty')).toBeVisible();
  });

  test('deleting one of two annotations leaves the other untouched', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'first');
    await highlightLines(page, 'DELTA', 'ECHO');
    await commentOn(page, 'second');
    await expect(cards(page)).toHaveCount(2);
    const accepted = answerNextDialog(page, true);
    await cards(page).first().getByTestId('annotation-card-delete').click();
    await accepted;
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('1');
  });
});

test.describe('zoom', () => {
  test('buttons step through the levels, and the select shows the current one', async ({
    page,
  }) => {
    await openApp(page);
    expect(await pageWidth(page)).toBe(450); // 360pt at the default 125 %
    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await expect.poll(() => pageWidth(page)).toBe(540);
    await expect(page.getByTestId('annotator-toolbar-zoom-select')).toHaveValue('1.5');
    await page.getByTestId('annotator-toolbar-zoom-out').click();
    await page.getByTestId('annotator-toolbar-zoom-out').click();
    await expect.poll(() => pageWidth(page)).toBe(396); // 1.1
    await expect(page.getByTestId('annotator-toolbar-zoom-select')).toHaveValue('1.1');
  });

  test('the lowest and highest levels clamp', async ({ page }) => {
    await openApp(page);
    const select = page.getByTestId('annotator-toolbar-zoom-select');
    await select.selectOption('0.25');
    await expect.poll(() => pageWidth(page)).toBe(90);
    for (let i = 0; i < 3; i++) await page.getByTestId('annotator-toolbar-zoom-out').click();
    await expect(select).toHaveValue('0.25');
    expect(await pageWidth(page)).toBe(90);
    await select.selectOption('4');
    await expect.poll(() => pageWidth(page)).toBe(1440);
    for (let i = 0; i < 3; i++) await page.getByTestId('annotator-toolbar-zoom-in').click();
    await expect(select).toHaveValue('4');
    expect(await pageWidth(page)).toBe(1440);
  });

  test('Ctrl+= , Ctrl+- and Ctrl+0 replace the browser zoom', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+=');
    await expect.poll(() => pageWidth(page)).toBe(540);
    await page.keyboard.press('Control+Shift+Equal'); // produces "+"
    await expect.poll(() => pageWidth(page)).toBe(630);
    await page.keyboard.press('Control+-');
    await expect.poll(() => pageWidth(page)).toBe(540);
    await page.keyboard.press('Control+0');
    await expect.poll(() => pageWidth(page)).toBe(360);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1); // browser zoom untouched
  });

  test('Ctrl+wheel zooms and a plain wheel does not', async ({ page }) => {
    await openApp(page);
    const viewer = await boxOf(page.locator('app-pdf-viewer'));
    await page.mouse.move(viewer.x + 20, viewer.y + 20);
    await page.mouse.wheel(0, -120);
    expect(await pageWidth(page)).toBe(450);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect.poll(() => pageWidth(page)).toBe(540);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Control');
    await expect.poll(() => pageWidth(page)).toBe(450);
  });

  test('fit width fills the viewer, the select then shows a percentage, and steps continue from it', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('annotator-toolbar-fit-width').click();
    const viewer = await boxOf(page.locator('app-pdf-viewer'));
    await expect.poll(() => pageWidth(page)).toBeGreaterThan(450);
    const fitted = await pageWidth(page);
    expect(Math.abs(fitted - (viewer.width - 32))).toBeLessThanOrEqual(20); // scrollbar allowance
    const select = page.getByTestId('annotator-toolbar-zoom-select');
    const shown = await select.evaluate((el: HTMLSelectElement) => ({
      text: el.selectedOptions[0].textContent.trim(),
      value: el.value,
    }));
    expect(shown.text).toMatch(/^\d+%$/);
    expect(shown.value).not.toBe('fit');
    expect(ZOOM_STEPS.map(String)).not.toContain(shown.value);

    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await expect.poll(() => pageWidth(page)).toBeGreaterThan(fitted);
    const next = (await pageWidth(page)) / 360;
    expect(ZOOM_STEPS.some((step) => Math.abs(step - next) < 0.005)).toBe(true);
  });

  test('choosing "fit" in the select fits the width and does not leave the select on "fit"', async ({
    page,
  }) => {
    await openApp(page);
    const select = page.getByTestId('annotator-toolbar-zoom-select');
    await select.selectOption('fit');
    await expect.poll(() => pageWidth(page)).toBeGreaterThan(450);
    expect(await select.inputValue()).not.toBe('fit');
  });

  test('zooming keeps highlights aligned with the text', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await expect.poll(() => pageWidth(page)).toBe(540);
    const alpha = await boxOf(lineSpan(pageAt(page, 0), 'ALPHA'));
    const first = await boxOf(highlights(page).first());
    expect(Math.abs(first.y - alpha.y)).toBeLessThan(6);
    // the selection starts mid-line (where the drag began), so it lies within the ALPHA span
    expect(first.x).toBeGreaterThanOrEqual(alpha.x - 2);
    expect(first.x).toBeLessThanOrEqual(alpha.x + alpha.width);
  });
});

test.describe('search', () => {
  async function twoComments(page: Page): Promise<void> {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'Apple pie');
    await highlightLines(page, 'DELTA', 'ECHO');
    await commentOn(page, 'banana split');
    await expect(cards(page)).toHaveCount(2);
  }

  test('filters by comment, case-insensitively and ignoring surrounding spaces', async ({
    page,
  }) => {
    await twoComments(page);
    await page.getByTestId('annotator-sidebar-search').fill('  APPLE  ');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Apple pie');
  });

  test('filters by quote too', async ({ page }) => {
    await twoComments(page);
    await page.getByTestId('annotator-sidebar-search').fill('echo');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('banana');
  });

  test('a term that matches nothing shows the no-match message, not the empty hint', async ({
    page,
  }) => {
    await twoComments(page);
    await page.getByTestId('annotator-sidebar-search').fill('zzz');
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByTestId('annotator-sidebar-empty')).toHaveText(ES['SIDEBAR.NO_MATCH']);
    await page.getByTestId('annotator-sidebar-search').fill('');
    await expect(cards(page)).toHaveCount(2);
  });

  test('without annotations the empty hint shows (not the no-match message)', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('annotator-sidebar-empty')).toHaveText(ES['SIDEBAR.EMPTY_HINT']);
    await page.getByTestId('annotator-sidebar-search').fill('anything');
    await expect(page.getByTestId('annotator-sidebar-empty')).toHaveText(ES['SIDEBAR.NO_MATCH']);
  });

  test('search treats regex characters literally', async ({ page }) => {
    await twoComments(page);
    await page.getByTestId('annotator-sidebar-search').fill('.*');
    await expect(cards(page)).toHaveCount(0);
    await page.getByTestId('annotator-sidebar-search').fill('(');
    await expect(cards(page)).toHaveCount(0);
  });

  test('the count ignores the filter and counts commented annotations only', async ({ page }) => {
    await twoComments(page);
    await page.getByTestId('annotator-sidebar-search').fill('apple');
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('2');
  });

  test('a highlight with no comment is listed only while selected', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotation-card-cancel').click();
    await expect(cards(page)).toHaveCount(1); // still selected
    await clickPageWhitespace(page); // a click on bare page deselects
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('0');
    await expect(highlights(page).first()).toBeVisible();
  });
});

test.describe('sidebar resizer', () => {
  const KEY = 'pdf-annotations.sidebar-width';

  test('starts at 380px with correct separator semantics', async ({ page }) => {
    await openApp(page);
    await expect.poll(() => sidebarWidth(page)).toBe(380);
    const separator = page.getByTestId('sidebar-resizer');
    await expect(separator).toHaveAttribute('role', 'separator');
    await expect(separator).toHaveAttribute('aria-valuenow', '380');
    await expect(separator).toHaveAttribute('aria-valuemin', '260');
    await expect(separator).toHaveAttribute('aria-valuemax', '896'); // 70 % of 1280
  });

  test('dragging with the pointer sets the width from the right edge and persists it', async ({
    page,
  }) => {
    await openApp(page);
    const handle = await centreOf(page.getByTestId('sidebar-resizer'));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(800, handle.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => sidebarWidth(page)).toBe(480);
    await expect(page.getByTestId('sidebar-resizer')).toHaveAttribute('aria-valuenow', '480');
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('480');
    await page.reload();
    await page.getByTestId('annotator-empty-open').click();
    await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
    await expect.poll(() => sidebarWidth(page)).toBe(480);
  });

  test('the drag clamps at the minimum and at 70 % of the viewport, even far outside the window edge', async ({
    page,
  }) => {
    await openApp(page);
    const handle = await centreOf(page.getByTestId('sidebar-resizer'));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(1279, handle.y, { steps: 5 });
    await expect.poll(() => sidebarWidth(page)).toBe(260);
    await page.mouse.move(2, handle.y, { steps: 5 });
    await expect.poll(() => sidebarWidth(page)).toBe(896);
    await page.mouse.up();
  });

  test('moving the pointer without pressing never resizes', async ({ page }) => {
    await openApp(page);
    const handle = await centreOf(page.getByTestId('sidebar-resizer'));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.move(handle.x - 100, handle.y);
    await page.waitForTimeout(150);
    await expect.poll(() => sidebarWidth(page)).toBe(380);
  });

  test('the drag stops on release: later movement is ignored', async ({ page }) => {
    await openApp(page);
    const handle = await centreOf(page.getByTestId('sidebar-resizer'));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(800, handle.y, { steps: 5 });
    await expect.poll(() => sidebarWidth(page)).toBe(480);
    await page.mouse.up();
    await page.mouse.move(500, handle.y, { steps: 5 });
    await page.waitForTimeout(150);
    await expect.poll(() => sidebarWidth(page)).toBe(480);
  });

  test('arrow keys move by 20px and Shift+arrow by 80px, in the direction of the sidebar', async ({
    page,
  }) => {
    await openApp(page);
    const separator = page.getByTestId('sidebar-resizer');
    await separator.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => sidebarWidth(page)).toBe(400);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => sidebarWidth(page)).toBe(480);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => sidebarWidth(page)).toBe(460);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => sidebarWidth(page)).toBe(380);
    await expect(separator).toHaveAttribute('aria-valuenow', '380');
  });

  test('keyboard resizing clamps and other keys do nothing', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('sidebar-resizer').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => sidebarWidth(page)).toBe(260);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => sidebarWidth(page)).toBe(896);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    await expect.poll(() => sidebarWidth(page)).toBe(896);
  });

  test('double-click resets to 380 and persists the reset', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('sidebar-resizer').focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => sidebarWidth(page)).toBe(460);
    await page.getByTestId('sidebar-resizer').dblclick();
    await expect.poll(() => sidebarWidth(page)).toBe(380);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('380');
  });

  test('the separator is reachable with Tab and shows a visible focus indicator', async ({
    page,
  }) => {
    await openApp(page);
    const separator = page.getByTestId('sidebar-resizer');
    await separator.focus();
    await expect(separator).toBeFocused();
    const outline = await separator.evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.outlineStyle}|${style.outlineWidth}|${style.boxShadow}`;
    });
    expect(outline).not.toBe('none|0px|none');
  });

  for (const stored of ['abc', '', '-5', '100', '259']) {
    test(`an invalid stored width "${stored}" falls back to the default`, async ({ page }) => {
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
      await expect.poll(() => sidebarWidth(page)).toBe(380);
    });
  }

  test('a stored width larger than the viewport allows is clamped, not trusted', async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '5000'), KEY);
    await openApp(page);
    await expect.poll(() => sidebarWidth(page)).toBeLessThanOrEqual(896);
    const viewer = await boxOf(page.locator('app-pdf-viewer'));
    expect(viewer.width).toBeGreaterThan(300);
  });

  test('a stored width above the max is reported consistently by aria-valuenow', async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '3000'), KEY);
    await openApp(page);
    const now = Number(await page.getByTestId('sidebar-resizer').getAttribute('aria-valuenow'));
    const max = Number(await page.getByTestId('sidebar-resizer').getAttribute('aria-valuemax'));
    expect(now).toBeLessThanOrEqual(max);
  });
});

test.describe('reading modes', () => {
  const MODE_KEY = 'pdf-annotations.reading-mode';

  test('each mode sets data-theme, aria-pressed and the page filter, and normal clears them', async ({
    page,
  }) => {
    await openApp(page);
    const html = page.locator('html');
    const pageOne = pageAt(page, 0);
    await expect(page.getByTestId('annotator-toolbar-reading-mode-normal')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(html).not.toHaveAttribute('data-theme', /.*/);
    await page.getByTestId('annotator-toolbar-reading-mode-sepia').click();
    await expect(html).toHaveAttribute('data-theme', 'sepia');
    await expect(pageOne).toHaveCSS('filter', /sepia/);
    await expect(page.getByTestId('annotator-toolbar-reading-mode-sepia')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('annotator-toolbar-reading-mode-normal')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByTestId('annotator-toolbar-reading-mode-night').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(pageOne).toHaveCSS('filter', /invert/);
    await page.getByTestId('annotator-toolbar-reading-mode-normal').click();
    await expect(html).not.toHaveAttribute('data-theme', /.*/);
    await expect(pageOne).toHaveCSS('filter', 'none');
  });

  test('the mode persists across reload and survives a language switch', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('annotator-toolbar-reading-mode-night').click();
    await page.getByTestId('language-switcher-en').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('an invalid stored mode falls back to normal', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, 'neon'), MODE_KEY);
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('highlights keep their colour under a reading mode', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO', 'pink');
    await page.getByTestId('annotator-toolbar-reading-mode-sepia').click();
    await expect(highlights(page).first()).toHaveCSS('background-color', RGB.pink);
  });
});

test.describe('highlight popup', () => {
  test('appears centred under the mouse-up point and inside the window', async ({ page }) => {
    await openApp(page);
    const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
    const to = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
    await drag(page, from, to);
    const popup = await boxOf(page.getByTestId('highlight-popup'));
    expect(Math.abs(popup.x + popup.width / 2 - to.x)).toBeLessThan(3);
    expect(Math.abs(popup.y - (to.y + 12))).toBeLessThan(10);
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(1280);
    expect(popup.y + popup.height).toBeLessThanOrEqual(900);
  });

  for (const color of ['yellow', 'green', 'blue', 'pink'] as const) {
    test(`the ${color} swatch creates a ${color} highlight and the popup closes`, async ({
      page,
    }) => {
      await openApp(page);
      await highlightLines(page, 'ALPHA', 'BRAVO', color);
      await expect(page.getByTestId('highlight-popup')).toHaveCount(0);
      await expect(highlights(page).first()).toHaveCSS('background-color', RGB[color]);
      await expect(
        cards(page).first().getByTestId(`annotation-card-swatch-${color}`),
      ).toHaveAttribute('aria-checked', 'true');
    });
  }

  test('a card swatch recolours the highlight and moves aria-checked', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO', 'yellow');
    await page.getByTestId('annotation-card-swatch-blue').click();
    await expect(highlights(page).first()).toHaveCSS('background-color', RGB.blue);
    await expect(page.getByTestId('annotation-card-swatch-blue')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByTestId('annotation-card-swatch-yellow')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('Escape closes the popup without creating anything', async ({ page }) => {
    await openApp(page);
    const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
    const to = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
    await drag(page, from, to);
    await expect(page.getByTestId('highlight-popup')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('highlight-popup')).toHaveCount(0);
    await expect(highlights(page)).toHaveCount(0);
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
  });

  test('a mouse press outside the popup closes it; a press inside does not', async ({ page }) => {
    await openApp(page);
    const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
    const to = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
    await drag(page, from, to);
    const popup = page.getByTestId('highlight-popup');
    await popup.getByText(ES['POPUP.HIGHLIGHT'], { exact: true }).click();
    await expect(popup).toBeVisible();
    await page.mouse.click(5, 850);
    await expect(popup).toHaveCount(0);
    await expect(highlights(page)).toHaveCount(0);
  });

  test('a second selection replaces the popup instead of stacking another', async ({ page }) => {
    await openApp(page);
    await drag(
      page,
      await centreOf(lineSpan(pageAt(page, 0), 'ALPHA')),
      await centreOf(lineSpan(pageAt(page, 0), 'BRAVO')),
    );
    await drag(
      page,
      await centreOf(lineSpan(pageAt(page, 0), 'DELTA')),
      await centreOf(lineSpan(pageAt(page, 0), 'ECHO')),
    );
    await expect(page.getByTestId('highlight-popup')).toHaveCount(1);
    await page.getByTestId('highlight-popup-color-yellow').click();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotation-card-quote')).toContainText('ECHO');
  });

  test('the popup exposes toolbar semantics with a named button per colour', async ({ page }) => {
    await openApp(page);
    await drag(
      page,
      await centreOf(lineSpan(pageAt(page, 0), 'ALPHA')),
      await centreOf(lineSpan(pageAt(page, 0), 'BRAVO')),
    );
    const popup = page.getByTestId('highlight-popup');
    await expect(popup).toHaveAttribute('role', 'toolbar');
    for (const color of ['yellow', 'green', 'blue', 'pink']) {
      const button = popup.getByTestId(`highlight-popup-color-${color}`);
      expect(await button.getAttribute('aria-label')).toBeTruthy();
    }
  });

  test('a click on a highlight selects its card, a click elsewhere clears the selection', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'selectable');
    await clickPageWhitespace(page);
    await expect(highlights(page).first()).not.toHaveClass(/selected/);
    const box = await boxOf(highlights(page).first());
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(highlights(page).first()).toHaveClass(/pdf-page__highlight--selected/);
  });
});

test.describe('annotation card editor', () => {
  async function startEditing(page: Page): Promise<Locator> {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    return cards(page).first();
  }

  test('tabs expose tablist/tab/tabpanel wiring that follows the selected tab', async ({
    page,
  }) => {
    const card = await startEditing(page);
    const write = card.getByTestId('annotation-card-tab-write');
    const preview = card.getByTestId('annotation-card-tab-preview');
    const panel = card.getByTestId('annotation-card-panel');
    await expect(card.getByTestId('annotation-card-tablist')).toHaveAttribute('role', 'tablist');
    await expect(write).toHaveAttribute('role', 'tab');
    await expect(write).toHaveAttribute('aria-selected', 'true');
    await expect(preview).toHaveAttribute('aria-selected', 'false');
    const panelId = await panel.getAttribute('id');
    expect(panelId).toBeTruthy();
    await expect(write).toHaveAttribute('aria-controls', panelId ?? '');
    await expect(preview).toHaveAttribute('aria-controls', panelId ?? '');
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', (await write.getAttribute('id')) ?? '');

    await preview.click();
    await expect(preview).toHaveAttribute('aria-selected', 'true');
    await expect(write).toHaveAttribute('aria-selected', 'false');
    await expect(panel).toHaveAttribute(
      'aria-labelledby',
      (await preview.getAttribute('id')) ?? '',
    );
    await expect(card.getByTestId('annotation-card-editor')).toHaveCount(0);
    await expect(card.getByTestId('annotation-card-insert-table')).toHaveCount(0);
    await expect(card.getByTestId('annotation-card-preview')).toBeVisible();
  });

  test('the tab ids referenced by ARIA exist exactly once in the document', async ({ page }) => {
    const card = await startEditing(page);
    await card.getByTestId('annotation-card-tab-preview').click();
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id]')).map((el) => el.id),
    );
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const refs = await card.evaluate((el) =>
      Array.from(el.querySelectorAll('[aria-controls],[aria-labelledby]')).flatMap((node) =>
        [node.getAttribute('aria-controls'), node.getAttribute('aria-labelledby')].filter(
          (v): v is string => !!v,
        ),
      ),
    );
    for (const ref of refs) expect(ids).toContain(ref);
  });

  test('two annotations each get their own tab and panel ids', async ({ page }) => {
    const first = await startEditing(page);
    await commentOn(page, 'one');
    await highlightLines(page, 'DELTA', 'ECHO');
    await expect(cards(page)).toHaveCount(2);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id]')).map((el) => el.id),
    );
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    await first.getByTestId('annotation-card-edit').click();
    const all = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"],[role="tabpanel"]')).map((el) => el.id),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  test('tabs are keyboard operable: Shift+Tab from the editor reaches them and Enter/Space select', async ({
    page,
  }) => {
    const card = await startEditing(page);
    const write = card.getByTestId('annotation-card-tab-write');
    const preview = card.getByTestId('annotation-card-tab-preview');
    await expect(card.getByTestId('annotation-card-editor')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); // insert table
    await expect(card.getByTestId('annotation-card-insert-table')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(preview).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(preview).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(write).toBeFocused();
    await page.keyboard.press('Space');
    await expect(write).toHaveAttribute('aria-selected', 'true');
    await expect(card.getByTestId('annotation-card-editor')).toBeVisible();
  });

  test('typed text survives a trip to the preview tab and back', async ({ page }) => {
    const card = await startEditing(page);
    await card.getByTestId('annotation-card-editor').fill('# Title\n\n**bold** text');
    await card.getByTestId('annotation-card-tab-preview').click();
    await expect(card.getByTestId('annotation-card-preview').locator('h1')).toHaveText('Title');
    await expect(card.getByTestId('annotation-card-preview').locator('strong')).toHaveText('bold');
    await card.getByTestId('annotation-card-tab-write').click();
    await expect(card.getByTestId('annotation-card-editor')).toHaveValue(
      '# Title\n\n**bold** text',
    );
  });

  test('the preview never executes script from the comment', async ({ page }) => {
    const card = await startEditing(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await card
      .getByTestId('annotation-card-editor')
      .fill('<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>');
    await card.getByTestId('annotation-card-tab-preview').click();
    await expect(card.getByTestId('annotation-card-preview')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    expect(errors).toEqual([]);
  });

  test('re-editing starts on the Write tab with the saved text', async ({ page }) => {
    const card = await startEditing(page);
    await card.getByTestId('annotation-card-editor').fill('saved text');
    await card.getByTestId('annotation-card-tab-preview').click();
    await card.getByTestId('annotation-card-save').click();
    await card.getByTestId('annotation-card-edit').click();
    await expect(card.getByTestId('annotation-card-tab-write')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(card.getByTestId('annotation-card-editor')).toHaveValue('saved text');
    await expect(card.getByTestId('annotation-card-editor')).toBeFocused();
  });

  test('Escape cancels the edit and discards typing; Ctrl+Enter saves; neither bubbles to the page', async ({
    page,
  }) => {
    const card = await startEditing(page);
    await card.getByTestId('annotation-card-editor').fill('will be discarded');
    await page.keyboard.press('Escape');
    await expect(card.getByTestId('annotation-card-editor')).toHaveCount(0);
    await expect(card.getByTestId('annotation-card-comment')).toHaveCount(0);
    await card.getByTestId('annotation-card-add-comment').click();
    await expect(card.getByTestId('annotation-card-editor')).toHaveValue('');
    await card.getByTestId('annotation-card-editor').fill('kept');
    await page.keyboard.press('Control+Enter');
    await expect(card.getByTestId('annotation-card-comment')).toContainText('kept');
  });

  test('whitespace-only comments save as empty', async ({ page }) => {
    const card = await startEditing(page);
    await card.getByTestId('annotation-card-editor').fill('   \n  ');
    await card.getByTestId('annotation-card-save').click();
    await expect(card.getByTestId('annotation-card-comment')).toHaveCount(0);
    await expect(page.getByTestId('annotator-sidebar-count')).toHaveText('0');
  });

  test('the empty preview shows the translated placeholder, never raw markdown underscores', async ({
    page,
  }) => {
    const card = await startEditing(page);
    await card.getByTestId('annotation-card-tab-preview').click();
    const preview = card.getByTestId('annotation-card-preview');
    await expect(preview.locator('em')).toHaveText(ES['CARD.NO_COMMENT'].replaceAll('_', ''));
    await expect(preview).not.toContainText('_');
  });

  test('insert table adds a skeleton on its own lines and selects the first header', async ({
    page,
  }) => {
    const card = await startEditing(page);
    const editor = card.getByTestId('annotation-card-editor');
    await editor.fill('intro');
    await card.getByTestId('annotation-card-insert-table').click();
    const value = await editor.inputValue();
    expect(value.startsWith('intro\n\n| ')).toBe(true);
    expect(value).toContain(`| ${ES['CARD.TABLE_COLUMN_1']} | ${ES['CARD.TABLE_COLUMN_2']} |`);
    const selected = await editor.evaluate((el: HTMLTextAreaElement) =>
      el.value.slice(el.selectionStart, el.selectionEnd),
    );
    expect(selected).toBe(ES['CARD.TABLE_COLUMN_1']);
    await expect(editor).toBeFocused();
    await card.getByTestId('annotation-card-tab-preview').click();
    await expect(card.getByTestId('annotation-card-preview').locator('table')).toHaveCount(1);
  });

  test('insert table in the middle of text splits it with blank lines on both sides', async ({
    page,
  }) => {
    const card = await startEditing(page);
    const editor = card.getByTestId('annotation-card-editor');
    await editor.fill('abcd');
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 2));
    await card.getByTestId('annotation-card-insert-table').click();
    const value = await editor.inputValue();
    expect(value.startsWith('ab\n\n|')).toBe(true);
    expect(value.endsWith('|\n\ncd') || value.endsWith('|\ncd')).toBe(true);
    expect(value).toContain('cd');
  });

  test('insert table into an empty editor starts at the top, and twice yields two tables', async ({
    page,
  }) => {
    const card = await startEditing(page);
    const editor = card.getByTestId('annotation-card-editor');
    await card.getByTestId('annotation-card-insert-table').click();
    expect((await editor.inputValue()).startsWith('| ')).toBe(true);
    await editor.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(el.value.length, el.value.length),
    );
    await card.getByTestId('annotation-card-insert-table').click();
    await card.getByTestId('annotation-card-tab-preview').click();
    await expect(card.getByTestId('annotation-card-preview').locator('table')).toHaveCount(2);
  });

  test('clicking the quote or page chip scrolls and selects without opening the editor', async ({
    page,
  }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    await page.getByTestId('annotation-card-page').click();
    await expect(page.getByTestId('annotation-card-editor')).toHaveCount(0);
    await expect(highlights(page).first()).toHaveClass(/selected/);
  });

  test('page chip names the page the annotation is on', async ({ page }) => {
    await openApp(page);
    await drag(
      page,
      await centreOf(lineSpan(pageAt(page, 1), 'FOXTROT')),
      await centreOf(lineSpan(pageAt(page, 1), 'GOLF')),
    );
    await page.getByTestId('highlight-popup-color-yellow').click();
    await expect(page.getByTestId('annotation-card-page')).toHaveAttribute(
      'aria-label',
      ES['CARD.GO_TO_PAGE'].replace('{{page}}', '2'),
    );
  });
});

test.describe('store lifetime in the real app', () => {
  test('reloading the page starts from a clean store', async ({ page }) => {
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.reload();
    await expect(page.getByTestId('annotator-empty-state')).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });

  test('no uncaught error is thrown through a full session', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await openApp(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'session');
    await page.getByTestId('language-switcher-en').click();
    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
