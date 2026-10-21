import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  bundle,
  commentOn,
  fsState,
  highlightLines,
  installFileSystem,
  openApp,
  readStorage,
  savedBytes,
  setFs,
} from './fixtures/app-helpers';
import { annotationJson, buildEncryptedFixture } from './fixtures/pdf-builders';
import { lineSpan, pageAt } from './fixtures/pdf-page-helpers';
import { buildSelectionFixture } from './fixtures/selection-fixture';

const ES = bundle('es');
const KEY = 'pdf-annotations.recovery.fixture.pdf|2';
const PLAIN_KEY = 'pdf-annotations.recovery.plain.pdf|2';
const CARD = /^annotation-card-[0-9a-f-]{36}$/;
const PINK = 'rgb(244, 143, 177)';

const bar = (page: Page) => page.getByTestId('annotator-recovery');
const dirty = (page: Page) => page.getByTestId('annotator-toolbar-dirty');
const paused = (page: Page) => page.getByTestId('annotator-toolbar-autosave-paused');
const cards = (page: Page) => page.getByTestId(CARD);

interface StoredCopy {
  baseline: { size: number; lastModified: number };
  annotations: string;
}

async function copyOf(page: Page, key = KEY): Promise<StoredCopy | null> {
  const raw = await readStorage(page, key);
  return raw === null ? null : (JSON.parse(raw) as StoredCopy);
}

function copyJson(
  annotations: unknown[],
  baseline = { size: 1, lastModified: 1 },
): Record<string, string> {
  return {
    [KEY]: JSON.stringify({
      baseline,
      annotations: JSON.stringify({ version: 1, annotations }),
    }),
  };
}

/** Opens `buffer` through the `<input type=file>` fallback, as `name`. */
async function openWithInput(
  page: Page,
  source: Buffer | string,
  name = 'plain.pdf',
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('annotator-toolbar-open').click();
  await (
    await chooser
  ).setFiles(
    typeof source === 'string' ? source : { name, mimeType: 'application/pdf', buffer: source },
  );
  await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
}

test.describe('the copy is kept when changes cannot reach the disk', () => {
  test('a browser without file handles keeps a copy of every change', async ({ page }) => {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    expect(await copyOf(page, PLAIN_KEY)).toBeNull();
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'keep this');
    const copy = (await copyOf(page, PLAIN_KEY))!;
    expect(copy.baseline.size).toBeGreaterThan(0);
    expect(Number.isFinite(copy.baseline.lastModified)).toBe(true);
    expect(JSON.parse(copy.annotations).annotations).toHaveLength(1);
    expect(copy.annotations).toContain('keep this');
  });

  test('every later edit updates the copy, including a deletion', async ({ page }) => {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'one');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('annotation-card-delete').click();
    await expect(cards(page)).toHaveCount(0);
    const copy = (await copyOf(page, PLAIN_KEY))!;
    expect(JSON.parse(copy.annotations).annotations).toEqual([]);
  });

  test('a download clears it; "Descargar copia" does not', async ({ page }) => {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    const copyDownload = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save-copy').click();
    await copyDownload;
    expect(await copyOf(page, PLAIN_KEY)).not.toBeNull();
    await expect(dirty(page)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    await download;
    await expect(dirty(page)).toHaveCount(0);
    expect(await copyOf(page, PLAIN_KEY)).toBeNull();
  });

  test('an encrypted PDF opened with a handle keeps a copy, and exporting the JSON clears it', async ({
    page,
  }) => {
    await installFileSystem(page, { bytes: await buildEncryptedFixture(), autosave: true });
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-notice')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson('66666666-6666-4666-8666-666666666666', 'secret')),
    });
    await expect(dirty(page)).toBeVisible();
    const copy = (await copyOf(page, 'pdf-annotations.recovery.fixture.pdf|1'))!;
    expect(copy.annotations).toContain('secret');

    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    await download;
    expect(await copyOf(page, 'pdf-annotations.recovery.fixture.pdf|1')).toBeNull();
  });

  test('no copy is written while autosave is active and healthy', async ({ page }) => {
    await page.clock.install();
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    expect(await copyOf(page)).toBeNull();
    await page.clock.runFor(3600);
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    expect(await copyOf(page)).toBeNull();
  });

  test('with autosave switched off from the start no copy is written either', async ({ page }) => {
    await openApp(page, { autosave: false });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    expect(await copyOf(page)).toBeNull();
  });
});

test.describe('a handle document that autosaved and then lost the permission', () => {
  test('keeps a copy whose baseline is the written file; reopening offers the replace branch', async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'first');
    await page.clock.runFor(3600);
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    expect(await copyOf(page)).toBeNull();

    await setFs(page, { query: 'prompt', request: 'denied' });
    await page.getByTestId('annotation-card-swatch-pink').click();
    await page.clock.runFor(3600);
    await expect(paused(page)).toBeVisible();

    const disk = await fsState(page);
    const copy = (await copyOf(page))!;
    expect(copy.baseline).toEqual({ size: disk.bytes.length, lastModified: disk.lastModified });
    expect(copy.annotations).toContain('#f48fb1');
    const written = await savedBytes(page);
    const lastModified = disk.lastModified;
    await page.close();

    const reopened = await context.newPage();
    await installFileSystem(reopened, { bytes: written, lastModified });
    await reopened.goto('/');
    await reopened.getByTestId('annotator-toolbar-open').click();
    await expect(bar(reopened)).toBeVisible();
    await reopened.getByTestId('annotator-recovery-restore').click();
    await expect(bar(reopened)).toHaveCount(0);
    await expect(reopened.locator('[data-testid^="pdf-page-highlight-"]').first()).toHaveCSS(
      'background-color',
      PINK,
    );
    await expect(dirty(reopened)).toBeVisible();
  });

  test('when the file cannot be read back after the write, the old baseline is kept', async ({
    page,
  }) => {
    await page.clock.install();
    await openApp(page, { autosave: true });
    const initial = await fsState(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'first');
    await setFs(page, { failGetFile: true });
    await page.clock.runFor(3600);
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    await setFs(page, { query: 'prompt', request: 'denied' });
    await page.getByTestId('annotation-card-swatch-pink').click();
    await page.clock.runFor(3600);
    await expect(paused(page)).toBeVisible();
    const copy = (await copyOf(page))!;
    expect(copy.baseline).toEqual({
      size: initial.bytes.length,
      lastModified: initial.lastModified,
    });
  });
});

test.describe('switching autosave off', () => {
  test('freezes an existing copy, stops updating it, and the next successful save clears it', async ({
    page,
  }) => {
    await page.clock.install();
    await openApp(page, { autosave: true, permission: { query: 'prompt', request: 'denied' } });
    expect(await readStorage(page, KEY)).toBeNull(); // opening asks nothing and keeps no copy
    await highlightLines(page, 'ALPHA', 'BRAVO'); // the first change asks: denied, paused
    await expect(paused(page)).toBeVisible();
    await commentOn(page, 'before');
    const frozen = await readStorage(page, KEY);
    expect(frozen).toContain('before');

    await page.getByTestId('annotator-toolbar-autosave').click(); // off
    await page.getByTestId('annotation-card-swatch-pink').click();
    await page.getByTestId('annotation-card-edit').click();
    await commentOn(page, 'after');
    expect(await readStorage(page, KEY)).toBe(frozen);

    await setFs(page, { request: 'granted' });
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    expect(await readStorage(page, KEY)).toBeNull();
  });
});

test.describe('reopening with a copy', () => {
  /** A first session on `plain.pdf` that leaves a copy with one annotation behind. */
  async function leaveCopy(page: Page, comment: string): Promise<void> {
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, comment);
  }

  test('a changed file merges the copy by id; the bar is a labelled group apart from the notice', async ({
    page,
  }) => {
    await leaveCopy(page, 'unsaved note');
    await page.reload();
    await openWithInput(page, Buffer.from(await buildSelectionFixture())); // new File: other stamp
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toHaveAttribute('role', 'group');
    await expect(bar(page)).toHaveAttribute('aria-labelledby', 'annotator-recovery-label');
    await expect(page.locator('#annotator-recovery-label')).toHaveText(ES['NOTICE.RECOVERY']);
    await expect(page.getByTestId('annotator-recovery-restore')).toHaveText(
      ES['NOTICE.RECOVERY_ACTION'],
    );
    await expect(page.getByTestId('annotator-recovery-dismiss')).toHaveAttribute(
      'aria-label',
      ES['NOTICE.RECOVERY_DISMISS'],
    );
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    await expect(dirty(page)).toHaveCount(0);

    await page.getByTestId('annotator-recovery-restore').click();
    await expect(bar(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotation-card-comment')).toContainText('unsaved note');
    await expect(dirty(page)).toBeVisible();
  });

  test('dismissing keeps the copy, and it is offered again next time', async ({ page }) => {
    await leaveCopy(page, 'still here');
    await page.reload();
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await page.getByTestId('annotator-recovery-dismiss').click();
    await expect(bar(page)).toHaveCount(0);
    expect(await copyOf(page, PLAIN_KEY)).not.toBeNull();
    await expect(dirty(page)).toHaveCount(0);
    await page.reload();
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await expect(bar(page)).toBeVisible();
  });

  test('the same unmodified file replaces the annotations exactly: a deletion comes back out', async ({
    page,
  }, testInfo) => {
    const path = testInfo.outputPath('plain.pdf');
    writeFileSync(path, await buildSelectionFixture());
    await installFileSystem(page, { handle: false });
    await page.goto('/');

    // Session 1: annotate A and save the file to disk, so the file itself carries A.
    await openWithInput(page, path);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'A');
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    await (await download).saveAs(path);

    // Session 2: open that file, delete A, add B; the copy is made against this very file.
    await page.reload();
    await openWithInput(page, path);
    await expect(cards(page)).toHaveCount(1);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('annotation-card-delete').click();
    await expect(cards(page)).toHaveCount(0);
    await highlightLines(page, 'CHARLIE', 'DELTA');
    await commentOn(page, 'B');
    expect(await copyOf(page, PLAIN_KEY)).not.toBeNull();

    // Session 3: the file is untouched, so the copy replaces: only B, A stays deleted.
    await page.reload();
    await openWithInput(page, path);
    await expect(cards(page)).toHaveCount(1);
    await expect(bar(page)).toBeVisible();
    await page.getByTestId('annotator-recovery-restore').click();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('annotation-card-comment')).toHaveText('B');
    await expect(dirty(page)).toBeVisible();
  });

  test('a file touched since the copy merges instead: the file keeps A and B is added', async ({
    page,
  }, testInfo) => {
    const path = testInfo.outputPath('plain.pdf');
    writeFileSync(path, await buildSelectionFixture());
    await installFileSystem(page, { handle: false });
    await page.goto('/');
    await openWithInput(page, path);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'A');
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    await (await download).saveAs(path);

    await page.reload();
    await openWithInput(page, path);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('annotation-card-delete').click();
    await highlightLines(page, 'CHARLIE', 'DELTA');
    await commentOn(page, 'B');

    writeFileSync(path, readFileSync(path)); // same bytes, newer modification time
    await page.reload();
    await openWithInput(page, path);
    await page.getByTestId('annotator-recovery-restore').click();
    await expect(cards(page)).toHaveCount(2); // A from the file, B from the copy
  });

  test('a copy with nothing to give back is cleared without an offer', async ({ page }) => {
    await installFileSystem(page, { handle: false, storage: { [PLAIN_KEY]: copyJson([])[KEY] } });
    await page.goto('/');
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await expect(bar(page)).toHaveCount(0);
    expect(await copyOf(page, PLAIN_KEY)).toBeNull();
  });

  for (const garbage of [
    'not json',
    '{"baseline":1}',
    '{"baseline":{"size":"x"},"annotations":""}',
  ]) {
    test(`a corrupt copy ${garbage} is ignored without an error`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await installFileSystem(page, { handle: false, storage: { [PLAIN_KEY]: garbage } });
      await page.goto('/');
      await openWithInput(page, Buffer.from(await buildSelectionFixture()));
      await expect(bar(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('a copy for a file of another name or page count is not offered', async ({ page }) => {
    const other = copyJson([
      JSON.parse(annotationJson('77777777-7777-4777-8777-777777777777', 'x')).annotations[0],
    ])[KEY];
    await installFileSystem(page, {
      handle: false,
      storage: {
        'pdf-annotations.recovery.plain.pdf|3': other,
        'pdf-annotations.recovery.other.pdf|2': other,
      },
    });
    await page.goto('/');
    await openWithInput(page, Buffer.from(await buildSelectionFixture()));
    await expect(bar(page)).toHaveCount(0);
  });
});

test.describe('the recovery offer goes away once the user moves on', () => {
  async function openWithCopy(page: Page): Promise<void> {
    const copy = {
      baseline: { size: 1, lastModified: 1 },
      annotations: annotationJson('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'from before'),
    };
    await installFileSystem(page, {
      handle: false,
      storage: { [PLAIN_KEY]: JSON.stringify(copy) },
    });
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-open').click();
    await (
      await chooser
    ).setFiles({
      name: 'plain.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await buildSelectionFixture()),
    });
    await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
    await expect(bar(page)).toBeVisible();
  }

  test('zoom and search are not changes: the offer stays', async ({ page }) => {
    await openWithCopy(page);
    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await page.getByTestId('annotator-sidebar-search').fill('x');
    await expect(bar(page)).toBeVisible();
  });

  test('the first real change hides it', async ({ page }) => {
    await openWithCopy(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await expect(bar(page)).toHaveCount(0);
  });

  test('a save hides it', async ({ page }) => {
    await openWithCopy(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    await download;
    await expect(bar(page)).toHaveCount(0);
  });
});
