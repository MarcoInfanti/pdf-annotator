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
  setFs,
  savedBytes,
} from './fixtures/app-helpers';
import type { OpenOptions } from './fixtures/app-helpers';
import {
  annotationJson,
  annotationsIn,
  buildEncryptedFixture,
  objectCountOf,
} from './fixtures/pdf-builders';
import { buildSelectionFixture } from './fixtures/selection-fixture';

const ES = bundle('es');
const CARD = /^annotation-card-[0-9a-f-]{36}$/;
const AUTOSAVE_KEY = 'pdf-annotations.autosave';
const RECOVERY_KEY = 'pdf-annotations.recovery.fixture.pdf|2';

const status = (page: Page) => page.getByTestId('annotator-toolbar-save-status');
const unsaved = (page: Page) => page.getByTestId('annotator-toolbar-dirty');
const saving = (page: Page) => page.getByTestId('annotator-toolbar-saving');
const saved = (page: Page) => page.getByTestId('annotator-toolbar-saved');
const paused = (page: Page) => page.getByTestId('annotator-toolbar-autosave-paused');
const notice = (page: Page) => page.getByTestId('annotator-notice');
const toggle = (page: Page) => page.getByTestId('annotator-toolbar-autosave');

/** Installs the fake clock (time still flows) and opens the fixture with autosave on. */
async function openWithClock(page: Page, options: OpenOptions = {}): Promise<void> {
  await page.clock.install();
  await openApp(page, { autosave: true, ...options });
}

/** Highlights two lines and saves a comment: one real change, the editor closed. */
async function firstChange(page: Page): Promise<void> {
  await highlightLines(page, 'ALPHA', 'BRAVO');
  await commentOn(page, 'note');
}

/** Alternates the colour of the selected annotation: one real change per call. */
async function recolor(page: Page, color: 'pink' | 'blue'): Promise<void> {
  await page.getByTestId(`annotation-card-swatch-${color}`).click();
}

async function writes(page: Page): Promise<number> {
  return (await fsState(page)).writes;
}

/** Fake-clock milliseconds, the same clock the app's timers run on. */
function clockNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
}

/** True when a cancelable beforeunload asked to block the unload. */
function unloadIsBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

/** Pretends the tab went to the background. */
function hideTab(page: Page): Promise<void> {
  return page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('autosave timing', () => {
  test('writes once about 3 s after a change, not before, and never shows a notice', async ({
    page,
  }) => {
    await openWithClock(page);
    await firstChange(page);
    await expect(unsaved(page)).toBeVisible();
    await page.clock.runFor(2000);
    expect(await writes(page)).toBe(0);
    await expect(unsaved(page)).toBeVisible();
    await page.clock.runFor(1500);
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
    await expect(unsaved(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    await page.clock.runFor(60_000);
    expect(await writes(page)).toBe(1); // a clean document is never rewritten
  });

  test('the saved file holds the annotation', async ({ page }) => {
    await openWithClock(page);
    await firstChange(page);
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    const stored = await annotationsIn(await savedBytes(page));
    expect(stored).toHaveLength(1);
    expect(stored[0].comment).toBe('note');
  });

  test('a burst of changes is one write, 3 s after the last one', async ({ page }) => {
    await openWithClock(page);
    await firstChange(page);
    for (const color of ['pink', 'blue', 'pink'] as const) {
      await page.clock.runFor(1500);
      await recolor(page, color);
    }
    await page.clock.runFor(2000);
    expect(await writes(page)).toBe(0); // 4.5 s after the first change, 2 s after the last
    await page.clock.runFor(1800);
    await expect.poll(() => writes(page)).toBe(1);
    await page.clock.runFor(60_000);
    expect(await writes(page)).toBe(1);
    expect((await annotationsIn(await savedBytes(page)))[0].color).toBe('#f48fb1');
  });

  test('a change every 2 s cannot starve the save: it lands at about 30 s', async ({ page }) => {
    await openWithClock(page);
    await firstChange(page);
    const started = await clockNow(page);
    const colors = ['pink', 'blue'] as const;
    let changes = 0;
    while ((await writes(page)) === 0 && changes < 25) {
      await page.clock.runFor(2000);
      if ((await writes(page)) > 0) break;
      await recolor(page, colors[changes % 2]);
      changes += 1;
    }
    const waited = (await clockNow(page)) - started;
    expect(await writes(page)).toBe(1);
    expect(waited).toBeGreaterThanOrEqual(24_000); // a plain debounce would still be waiting
    expect(waited).toBeLessThanOrEqual(34_000);
    expect(changes).toBeGreaterThanOrEqual(10);
  });

  test('the delay doubles the last write duration when that is longer than 3 s', async ({
    page,
  }) => {
    await openWithClock(page, { writeDelayMs: 2000 });
    await firstChange(page);
    await page.clock.runFor(3500);
    await expect(saving(page)).toBeVisible();
    await page.clock.runFor(2000); // the first write takes 2 s
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
    await setFs(page, { writeDelayMs: 0 });

    await recolor(page, 'pink');
    await page.clock.runFor(3500); // 3 s would have fired already; 2 x 2 s has not
    expect(await writes(page)).toBe(1);
    await page.clock.runFor(1500);
    await expect.poll(() => writes(page)).toBe(2);
  });

  test('nothing but real changes schedules a save: zoom, search, selection and scroll do not', async ({
    page,
  }) => {
    await openWithClock(page);
    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await page.getByTestId('annotator-sidebar-search').fill('anything');
    await page.mouse.wheel(0, 300);
    await page.clock.runFor(40_000);
    expect(await writes(page)).toBe(0);
    await expect(unsaved(page)).toHaveCount(0);
    expect((await fsState(page)).writeAttempts).toBe(0);
  });

  test('a document that is not dirty and has not been saved shows no status', async ({ page }) => {
    await openWithClock(page);
    await expect(status(page)).toBeAttached();
    await expect(status(page)).toHaveText('');
    await expect(status(page)).toHaveAttribute('role', 'status');
    await expect(status(page)).toHaveAttribute('aria-live', 'polite');
  });
});

test.describe('autosave editor guard and tab hide', () => {
  test('nothing is written while the comment editor is open, however long it takes', async ({
    page,
  }) => {
    await openWithClock(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await expect(page.getByTestId('annotation-card-editor')).toBeVisible();
    await page.clock.runFor(35_000);
    expect(await writes(page)).toBe(0);
    await expect(unsaved(page)).toBeVisible();
  });

  test('closing the editor after the deadline passed writes at once', async ({ page }) => {
    await openWithClock(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.clock.runFor(35_000);
    expect(await writes(page)).toBe(0);
    await page.getByTestId('annotation-card-cancel').click();
    await expect.poll(() => writes(page)).toBe(1);
  });

  test('saving the comment after the deadline passed writes at once, with the comment', async ({
    page,
  }) => {
    await openWithClock(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.clock.runFor(35_000);
    await commentOn(page, 'late');
    await expect.poll(() => writes(page)).toBe(1);
    expect((await annotationsIn(await savedBytes(page)))[0].comment).toBe('late');
  });

  test('hiding the tab saves a pending change at once, even with the editor open, without the half-typed text', async ({
    page,
  }) => {
    await openWithClock(page);
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await page.getByTestId('annotation-card-editor').fill('half typed');
    await hideTab(page);
    await expect.poll(() => writes(page)).toBe(1);
    const stored = await annotationsIn(await savedBytes(page));
    expect(stored).toHaveLength(1);
    expect(stored[0].comment).toBe('');
  });

  test('hiding the tab with nothing pending writes nothing', async ({ page }) => {
    await openWithClock(page);
    await hideTab(page);
    await page.clock.runFor(1000);
    expect(await writes(page)).toBe(0);
    expect((await fsState(page)).writeAttempts).toBe(0);
  });

  test('showing the tab again writes nothing by itself', async ({ page }) => {
    await openWithClock(page);
    await firstChange(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(1000);
    expect(await writes(page)).toBe(0);
  });

  test('hiding the tab while autosave is paused does not try to write', async ({ page }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    await firstChange(page); // the prompt is denied: paused
    await expect(paused(page)).toBeVisible();
    await hideTab(page);
    await page.clock.runFor(1000);
    expect((await fsState(page)).writeAttempts).toBe(0);
    await expect(paused(page)).toBeVisible();
  });

  test('hiding the tab before the permission prompt is answered pauses silently and the recovery copy takes over', async ({
    page,
  }) => {
    await openWithClock(page, {
      permission: { query: 'prompt', request: 'granted' },
      requestDelayMs: 5000,
    });
    await firstChange(page);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    expect(await readStorage(page, RECOVERY_KEY)).toBeNull();
    await hideTab(page);
    await expect(paused(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    expect((await fsState(page)).writeAttempts).toBe(0);
    await expect.poll(() => readStorage(page, RECOVERY_KEY)).not.toBeNull();
  });
});

test.describe('serialized writes', () => {
  test('writes never overlap: a manual save queues behind a slow autosave and edits made meanwhile are kept', async ({
    page,
  }) => {
    await openWithClock(page, { writeDelayMs: 5000 });
    await firstChange(page);
    await page.clock.runFor(3500);
    await expect(saving(page)).toBeVisible();
    await recolor(page, 'pink'); // a newer revision than the one being written
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('annotator-toolbar-save')).toBeDisabled(); // manual save is busy
    await page.clock.runFor(5000); // first write commits
    await expect.poll(() => writes(page)).toBe(1);
    await page.clock.runFor(5000); // second write commits
    await expect.poll(() => writes(page)).toBe(2);
    expect((await fsState(page)).maxConcurrentWrites).toBe(1);
    await expect(saved(page)).toBeVisible();
    await expect(page.getByTestId('annotator-toolbar-save')).toBeEnabled();
    expect((await annotationsIn(await savedBytes(page)))[0].color).toBe('#f48fb1');
  });

  test('an edit during a slow autosave stays unsaved and is written by a second write', async ({
    page,
  }) => {
    await openWithClock(page, { writeDelayMs: 2000 });
    await firstChange(page);
    await page.clock.runFor(3500);
    await expect(saving(page)).toBeVisible();
    await recolor(page, 'pink');
    await page.clock.runFor(2000);
    await expect.poll(() => writes(page)).toBe(1);
    await expect(unsaved(page)).toBeVisible(); // the first write did not cover the edit
    await expect(saved(page)).toHaveCount(0);
    await page.clock.runFor(3500);
    await page.clock.runFor(2000);
    await expect.poll(() => writes(page)).toBe(2);
    await expect(saved(page)).toBeVisible();
    expect((await fsState(page)).maxConcurrentWrites).toBe(1);
    expect((await annotationsIn(await savedBytes(page)))[0].color).toBe('#f48fb1');
  });

  test('manual Save during a slow autosave of the same revision waits for it: one write, SAVED_IN, ends on Guardado', async ({
    page,
  }) => {
    await openWithClock(page, { writeDelayMs: 4000 });
    await firstChange(page);
    await page.clock.runFor(3500);
    await expect(saving(page)).toBeVisible();
    await page.getByTestId('annotator-toolbar-save').click();
    await page.clock.runFor(4000);
    await expect.poll(() => writes(page)).toBe(1);
    await expect(notice(page)).toContainText('fixture.pdf');
    await expect(notice(page)).toContainText(ES['NOTICE.SAVED_IN'].split('{{')[0].trim());
    await expect(saved(page)).toBeVisible();
    await page.clock.runFor(10_000);
    const state = await fsState(page);
    expect(state.writes).toBe(1);
    expect(state.writeAttempts).toBe(1);
    expect(state.requestPermissionCalls).toBe(0);
  });

  test('manual Save during an autosave that then fails does its own write and ends saved, not paused', async ({
    page,
  }) => {
    await openWithClock(page, { writeDelayMs: 4000 });
    await setFs(page, { failWrites: 1 });
    await firstChange(page);
    await page.clock.runFor(3500);
    await page.getByTestId('annotator-toolbar-save').click();
    await setFs(page, { writeDelayMs: 0 });
    await page.clock.runFor(4000); // the autosave write fails now
    await expect.poll(() => writes(page)).toBe(1);
    const state = await fsState(page);
    expect(state.writeAttempts).toBe(2);
    expect(state.maxConcurrentWrites).toBe(1);
    await expect(notice(page)).toContainText(ES['NOTICE.SAVED_IN'].split('{{')[0].trim());
    await expect(saved(page)).toBeVisible();
    await expect(paused(page)).toHaveCount(0);
  });

  test('a manual Save of a clean, never-saved document still writes the file', async ({ page }) => {
    await openWithClock(page);
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
  });
});

test.describe('the autosave toggle', () => {
  test('is on by default, flips, and the choice survives a reload', async ({ page }) => {
    await installFileSystem(page, { autosave: 'default' });
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY)).toBe('false');
    await page.reload();
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY)).toBe('true');
  });

  test('is a native button reachable and operable with the keyboard, and does not show state by glyph alone', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await toggle(page).focus();
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toHaveAttribute('title', ES['TOOLBAR.AUTOSAVE_TITLE_ON']);
    await toggle(page).press('Space');
    await expect(toggle(page)).toHaveAttribute('title', ES['TOOLBAR.AUTOSAVE_TITLE_OFF']);
  });

  test('switched off, changes are never written; the indicator stays on "sin guardar"', async ({
    page,
  }) => {
    await openWithClock(page);
    await toggle(page).click();
    await firstChange(page);
    await page.clock.runFor(60_000);
    expect((await fsState(page)).writeAttempts).toBe(0);
    await expect(unsaved(page)).toBeVisible();
    await expect(paused(page)).toHaveCount(0);
  });

  test('switched off while a save is scheduled, the scheduled save is cancelled', async ({
    page,
  }) => {
    await openWithClock(page);
    await firstChange(page);
    await page.clock.runFor(1000);
    await toggle(page).click();
    await page.clock.runFor(60_000);
    expect((await fsState(page)).writeAttempts).toBe(0);
  });

  test('switched on again with a change pending, the change is written', async ({ page }) => {
    await openWithClock(page);
    await toggle(page).click();
    await firstChange(page);
    await page.clock.runFor(10_000);
    expect(await writes(page)).toBe(0);
    await toggle(page).click();
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
  });

  test('is disabled with an explanatory title for a browser without file handles', async ({
    page,
  }) => {
    await installFileSystem(page, { handle: false });
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
    await expect(toggle(page)).toBeDisabled();
    await expect(toggle(page)).toHaveAttribute('title', ES['TOOLBAR.AUTOSAVE_UNAVAILABLE']);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('is disabled for an encrypted PDF opened with a handle, which is never written', async ({
    page,
  }) => {
    await page.clock.install();
    await installFileSystem(page, { bytes: await buildEncryptedFixture(), autosave: true });
    await page.goto('/');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(notice(page)).toContainText(ES['NOTICE.ENCRYPTED'].slice(0, 20));
    await expect(toggle(page)).toBeDisabled();
    await expect(toggle(page)).toHaveAttribute('title', ES['TOOLBAR.AUTOSAVE_UNAVAILABLE']);

    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson('11111111-1111-4111-8111-111111111111', 'x')),
    });
    await expect(unsaved(page)).toBeVisible();
    await page.clock.runFor(60_000);
    expect((await fsState(page)).writeAttempts).toBe(0);
    await expect(unsaved(page)).toBeVisible();
    await expect(paused(page)).toHaveCount(0);

    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save').click();
    expect((await download).suggestedFilename()).toBe('fixture.annotations.json');
    expect((await fsState(page)).writeAttempts).toBe(0);
    await expect(unsaved(page)).toHaveCount(0);
  });

  test('switching off and on clears a pause, and a later change is tried again', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    await firstChange(page); // the prompt is denied: paused
    await expect(paused(page)).toBeVisible();
    await toggle(page).click(); // off: the pause is not shown for an inactive autosave
    await expect(paused(page)).toHaveCount(0);
    await toggle(page).click(); // on: the pause is cleared
    await expect(paused(page)).toHaveCount(0);
    await setFs(page, { query: 'granted' });
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
  });
});

test.describe('permission and failures', () => {
  test('the picker is opened read-only: write access is not asked for at open', async ({
    page,
  }) => {
    await openApp(page);
    const options = (await fsState(page)).pickerOptions;
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveProperty('mode');
  });

  test('opening asks nothing: no prompt, an idle indicator, no pause and no recovery copy', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    const state = await fsState(page);
    expect(state.requestPermissionCalls).toBe(0);
    await expect(status(page)).toHaveText('');
    await expect(paused(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    expect(await readStorage(page, RECOVERY_KEY)).toBeNull();
    await page.clock.runFor(60_000);
    expect((await fsState(page)).requestPermissionCalls).toBe(0);
  });

  test('the first change asks at once, before any timer; a denial pauses quietly and starts the recovery copy', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    await firstChange(page);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    await expect(paused(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    expect(await readStorage(page, RECOVERY_KEY)).not.toBeNull();
    await recolor(page, 'pink');
    await page.clock.runFor(60_000);
    const state = await fsState(page);
    expect(state.writeAttempts).toBe(0);
    expect(state.requestPermissionCalls).toBe(1); // asked once per document, never from a timer
    await expect(notice(page)).toHaveCount(0);
    expect(await readStorage(page, RECOVERY_KEY)).toContain('#f48fb1'); // the copy follows later edits
  });

  test('a grant on the first change lets autosave go on, and later changes do not ask again', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'granted' } });
    await firstChange(page);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    await expect(paused(page)).toHaveCount(0);
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    await recolor(page, 'pink');
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(2);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    expect(await readStorage(page, RECOVERY_KEY)).toBeNull();
  });

  test('changes made while the prompt is unanswered wait: nothing is scheduled until the answer', async ({
    page,
  }) => {
    await openWithClock(page, {
      permission: { query: 'prompt', request: 'granted' },
      requestDelayMs: 8000,
    });
    await firstChange(page);
    await recolor(page, 'pink');
    await page.clock.runFor(7000); // longer than the 3 s debounce, shorter than the prompt
    let state = await fsState(page);
    expect(state.writeAttempts).toBe(0);
    expect(state.requestPermissionCalls).toBe(1); // the second change did not ask again
    await page.clock.runFor(2000); // the user answers: granted
    await expect(paused(page)).toHaveCount(0);
    await page.clock.runFor(1000);
    expect(await writes(page)).toBe(0); // the debounce starts at the answer
    await page.clock.runFor(2500);
    await expect.poll(() => writes(page)).toBe(1);
    state = await fsState(page);
    expect(state.requestPermissionCalls).toBe(1);
    expect((await annotationsIn(await savedBytes(page)))[0].color).toBe('#f48fb1');
  });

  test('switching autosave on while a change is pending asks on that click', async ({ page }) => {
    await openWithClock(page, {
      autosave: false,
      permission: { query: 'prompt', request: 'granted' },
    });
    await firstChange(page);
    await page.clock.runFor(10_000);
    expect((await fsState(page)).requestPermissionCalls).toBe(0);
    await toggle(page).click();
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
  });

  test('a manual Save settles the permission, so autosave does not ask again afterwards', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'granted' } });
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(() => writes(page)).toBe(1);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    await firstChange(page);
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(2);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
  });

  test('Save after a denial asks again; denied shows the permission notice, granted writes and resumes autosave', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    await firstChange(page);
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(notice(page)).toContainText(ES['NOTICE.PERMISSION_DENIED'].slice(0, 25));
    expect((await fsState(page)).requestPermissionCalls).toBe(2);
    expect(await writes(page)).toBe(0);
    await expect(paused(page)).toBeVisible();

    await setFs(page, { request: 'granted' });
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(() => writes(page)).toBe(1);
    await expect(notice(page)).toContainText(ES['NOTICE.SAVED_IN'].split('{{')[0].trim());
    await expect(saved(page)).toBeVisible();
    await expect(paused(page)).toHaveCount(0);

    await recolor(page, 'pink');
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(2); // autosave runs again
  });

  test('losing the permission mid-session pauses autosave quietly and never loops', async ({
    page,
  }) => {
    await openWithClock(page);
    await firstChange(page);
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    await setFs(page, { query: 'prompt', request: 'denied' });
    await recolor(page, 'pink');
    await page.clock.runFor(3600);
    await expect(paused(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await recolor(page, 'blue');
    await page.clock.runFor(120_000);
    const state = await fsState(page);
    expect(state.writes).toBe(1);
    expect(state.writeAttempts).toBe(1);
    await expect(notice(page)).toHaveCount(0);
  });

  test('a failing write pauses autosave and reports the error once, without retrying', async ({
    page,
  }) => {
    await openWithClock(page);
    await setFs(page, { failWrites: 1000 });
    await firstChange(page);
    await page.clock.runFor(3600);
    await expect(paused(page)).toBeVisible();
    await expect(notice(page)).toContainText('disk full');
    await expect(notice(page)).toContainText(ES['NOTICE.ERROR'].split('{{')[0].trim());
    await page.getByTestId('annotator-notice-dismiss').click();
    await recolor(page, 'pink');
    await page.clock.runFor(120_000);
    await expect(notice(page)).toHaveCount(0); // the error does not come back
    expect((await fsState(page)).writeAttempts).toBe(1);
    await expect(unsaved(page)).toHaveCount(0); // paused wins over unsaved
    await expect(paused(page)).toBeVisible();
  });

  test('Save after a failure writes once the disk works again and autosave resumes', async ({
    page,
  }) => {
    await openWithClock(page);
    await setFs(page, { failWrites: 1 });
    await firstChange(page);
    await page.clock.runFor(3600);
    await expect(paused(page)).toBeVisible();
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
    await expect(paused(page)).toHaveCount(0);
    await recolor(page, 'pink');
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(2);
  });

  test('a failing manual Save reports the error, keeps the document dirty, and does not pause a healthy autosave', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    await setFs(page, { failWrites: 1 });
    await page.getByTestId('annotator-toolbar-save').click();
    await expect(notice(page)).toContainText('disk full');
    await expect(page.getByTestId('annotator-toolbar-save')).toBeEnabled();
    await expect(unsaved(page)).toBeVisible();
  });

  test('without queryPermission and requestPermission (older browsers) autosave still writes and never prompts', async ({
    page,
  }) => {
    await openWithClock(page, { permission: 'absent' });
    await firstChange(page);
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    expect((await fsState(page)).requestPermissionCalls).toBe(0);
    await expect(paused(page)).toHaveCount(0);
  });

  test('a file whose getFile fails after a write still counts as saved, with no pause and no notice', async ({
    page,
  }) => {
    await openWithClock(page);
    await firstChange(page);
    await setFs(page, { failGetFile: true });
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
    await expect(paused(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe('opening over pending changes with autosave on', () => {
  test('a clean document opens the next file without a write or a prompt', async ({ page }) => {
    await openApp(page, { autosave: true });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-toolbar-open').click();
    await expect.poll(async () => (await fsState(page)).pickerCalls).toBe(2);
    expect(dialogs).toEqual([]);
    expect(await writes(page)).toBe(0);
  });

  test('cancelling the picker with a change pending does nothing: no write, no prompt, session kept', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await firstChange(page);
    await page.evaluate(() => {
      Object.assign(window, {
        showOpenFilePicker: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
      });
    });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-toolbar-open')).toBeEnabled();
    expect(dialogs).toEqual([]);
    expect((await fsState(page)).writeAttempts).toBe(0);
    await expect(unsaved(page)).toBeVisible();
    await expect(page.getByTestId(/^annotation-card-[0-9a-f-]{36}$/)).toHaveCount(1);
  });

  test('a paused session with a change pending asks before it is replaced, and declining keeps it', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    await firstChange(page);
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-toolbar-open').click();
    await expect.poll(() => message).toBe(ES['CONFIRM.DISCARD_CHANGES']);
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('fixture.pdf');
    await expect(page.getByTestId(/^annotation-card-[0-9a-f-]{36}$/)).toHaveCount(1);
    expect(await writes(page)).toBe(0);
  });
});

test.describe('leaving the page', () => {
  test('unloading is blocked while a write is in flight, and free once it has finished', async ({
    page,
  }) => {
    await openWithClock(page, { writeDelayMs: 5000 });
    await firstChange(page);
    await page.clock.runFor(3500);
    await expect(saving(page)).toBeVisible();
    expect(await unloadIsBlocked(page)).toBe(true);
    await page.clock.runFor(5000);
    await expect.poll(() => writes(page)).toBe(1);
    await expect(saved(page)).toBeVisible();
    expect(await unloadIsBlocked(page)).toBe(false);
  });

  test('unloading is blocked while paused with unsaved changes', async ({ page }) => {
    await openApp(page, { autosave: true, permission: { query: 'prompt', request: 'denied' } });
    await firstChange(page);
    expect(await unloadIsBlocked(page)).toBe(true);
  });
});

test.describe('file growth', () => {
  test('saving and reopening the same file five times does not grow it or add objects', async ({
    page,
  }) => {
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson('22222222-2222-4222-8222-222222222222', 'keep me')),
    });
    const sizes: number[] = [];
    const objects: number[] = [];
    for (let cycle = 0; cycle < 5; cycle++) {
      await page.getByTestId('annotator-toolbar-save').click();
      await expect.poll(() => writes(page)).toBe(cycle + 1);
      await expect(page.getByTestId('annotator-toolbar-save')).toBeEnabled();
      const bytes = await savedBytes(page);
      sizes.push(bytes.length);
      objects.push(await objectCountOf(bytes));
      await page.getByTestId('annotator-toolbar-open').click(); // reads the bytes just written
      await expect(page.getByTestId('annotator-toolbar-dirty')).toHaveCount(0);
      await expect.poll(async () => (await fsState(page)).pickerCalls).toBe(cycle + 2);
      await expect(page.getByTestId(/^annotation-card-[0-9a-f-]{36}$/)).toHaveCount(1);
    }
    expect(new Set(sizes.slice(1)).size).toBe(1);
    expect(new Set(objects.slice(1)).size).toBe(1);
    expect((await annotationsIn(await savedBytes(page)))[0].comment).toBe('keep me');
  });
});

test.describe('opening the file that is being edited', () => {
  test('with a change pending, the same file reopens with the annotation that was just saved', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'just saved');
    await page.getByTestId('annotator-toolbar-open').click();
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    await expect(page.getByTestId(CARD)).toHaveCount(1);
    await expect(page.getByTestId('annotation-card-comment')).toContainText('just saved');
    await expect(unsaved(page)).toHaveCount(0);
    expect((await fsState(page)).pickerCalls).toBe(2);
  });

  test('if the file cannot be read back after the save, a notice appears and the saved session stays', async ({
    page,
  }) => {
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'kept');
    await setFs(page, { failGetFileAfterWrite: true, name: 'other.pdf' });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByTestId('annotator-toolbar-open').click();
    await expect(page.getByTestId('annotator-notice')).toContainText('file unreadable');
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('fixture.pdf');
    await expect(page.getByTestId('annotator-toolbar-open')).toBeEnabled();
    await expect(page.getByTestId(CARD)).toHaveCount(1);
    await expect(unsaved(page)).toHaveCount(0);
    expect((await fsState(page)).writes).toBe(1);
    expect(dialogs).toEqual([]);
  });
});

test.describe('edits that change nothing', () => {
  /** An annotation with a saved comment, already written by autosave. */
  async function savedAnnotation(page: Page): Promise<void> {
    await page.clock.install();
    await openApp(page, { autosave: true });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'note');
    await page.clock.runFor(3600);
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    await expect(saved(page)).toBeVisible();
  }

  test('choosing the colour the annotation already has neither dirties nor writes', async ({
    page,
  }) => {
    await savedAnnotation(page);
    await page.getByTestId('annotation-card-swatch-yellow').click();
    await page.clock.runFor(60_000);
    await expect(unsaved(page)).toHaveCount(0);
    await expect(saved(page)).toBeVisible();
    expect((await fsState(page)).writes).toBe(1);
  });

  test('saving the same comment closes the editor but changes nothing', async ({ page }) => {
    await savedAnnotation(page);
    await page.getByTestId('annotation-card-edit').click();
    await expect(page.getByTestId('annotation-card-editor')).toBeVisible();
    await commentOn(page, 'note');
    await expect(page.getByTestId('annotation-card-editor')).toHaveCount(0);
    await page.clock.runFor(60_000);
    await expect(unsaved(page)).toHaveCount(0);
    expect((await fsState(page)).writes).toBe(1);
  });

  test('a different comment or colour is still a change that is written', async ({ page }) => {
    await savedAnnotation(page);
    await page.getByTestId('annotation-card-swatch-pink').click();
    await expect(unsaved(page)).toBeVisible();
    await page.clock.runFor(3600);
    await expect.poll(async () => (await fsState(page)).writes).toBe(2);
    expect((await annotationsIn(await savedBytes(page)))[0].color).toBe('#f48fb1');
  });

  test('importing a JSON whose annotations are already there neither dirties nor writes', async ({
    page,
  }) => {
    await savedAnnotation(page);
    const [existing] = await annotationsIn(await savedBytes(page));
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'same.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson(existing.id, 'note')),
    });
    await page.clock.runFor(60_000);
    await expect(unsaved(page)).toHaveCount(0);
    expect((await fsState(page)).writes).toBe(1);
  });

  test('importing a JSON with a new annotation is still a change', async ({ page }) => {
    await savedAnnotation(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'new.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'brand new')),
    });
    await expect(unsaved(page)).toBeVisible();
    await page.clock.runFor(3600);
    await expect.poll(async () => (await fsState(page)).writes).toBe(2);
  });
});

test.describe('importing JSON asks for write access first', () => {
  /** Clicks Import JSON and answers the chooser with `files` (an empty list cancels it). */
  async function importFiles(
    page: Page,
    files: { name: string; content: string }[],
  ): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles(
      files.map(({ name, content }) => ({
        name,
        mimeType: 'application/json',
        buffer: Buffer.from(content),
      })),
    );
  }

  test('the permission is requested before the chooser opens, and the import is then written', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'granted' } });
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    const opened = await chooser;
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    await opened.setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'imported')),
    });
    await expect(unsaved(page)).toBeVisible();
    await page.clock.runFor(3600);
    await expect.poll(() => writes(page)).toBe(1);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
  });

  test('it asks even if the chooser is then cancelled', async ({ page }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'granted' } });
    await importFiles(page, []);
    expect((await fsState(page)).requestPermissionCalls).toBe(1);
    await expect(unsaved(page)).toHaveCount(0);
  });

  test('a denial pauses autosave, the chooser still opens, and the import is kept in the recovery copy', async ({
    page,
  }) => {
    await openWithClock(page, { permission: { query: 'prompt', request: 'denied' } });
    await importFiles(page, [
      {
        name: 'a.json',
        content: annotationJson('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'imported'),
      },
    ]);
    await expect(paused(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await page.clock.runFor(60_000);
    expect((await fsState(page)).writeAttempts).toBe(0);
    expect(await readStorage(page, RECOVERY_KEY)).toContain('imported');
  });

  test('it does not ask when autosave is off', async ({ page }) => {
    await openApp(page, { autosave: false, permission: { query: 'prompt', request: 'granted' } });
    await importFiles(page, []);
    expect((await fsState(page)).requestPermissionCalls).toBe(0);
  });
});

for (const [locale, lang] of [
  ['es-ES', 'es'],
  ['en-US', 'en'],
] as const) {
  test.describe(`import with an expired user activation (${lang})`, () => {
    test.use({ locale });

    /** Makes the browser report that the click activation has run out (or that it cannot tell). */
    async function fakeActivation(page: Page, isActive: boolean | null): Promise<void> {
      await page.addInitScript((value) => {
        Object.defineProperty(navigator, 'userActivation', {
          configurable: true,
          get: () => (value === null ? undefined : { isActive: value, hasBeenActive: true }),
        });
      }, isActive);
    }

    test('shows the retry notice and does not open the chooser', async ({ page }) => {
      await fakeActivation(page, false);
      await openApp(page, { autosave: false });
      let chooserOpened = false;
      page.on('filechooser', () => (chooserOpened = true));
      await page.getByTestId('annotator-toolbar-import-json').click();
      await expect(notice(page)).toContainText(bundle(lang)['NOTICE.IMPORT_RETRY']);
      await page.waitForTimeout(500);
      expect(chooserOpened).toBe(false);
      await expect(page.getByTestId('annotator-toolbar-import-json')).toBeEnabled();
      await expect(unsaved(page)).toHaveCount(0);
    });

    test('pressing the button again with a live activation opens the chooser', async ({ page }) => {
      await fakeActivation(page, false);
      await openApp(page, { autosave: false });
      await page.getByTestId('annotator-toolbar-import-json').click();
      await expect(notice(page)).toBeVisible();
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'userActivation', {
          configurable: true,
          get: () => ({ isActive: true, hasBeenActive: true }),
        });
      });
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('annotator-toolbar-import-json').click();
      await chooser;
    });

    test('a browser that cannot report activation proceeds to the chooser', async ({ page }) => {
      await fakeActivation(page, null);
      await openApp(page, { autosave: false });
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('annotator-toolbar-import-json').click();
      await chooser;
      await expect(notice(page)).toHaveCount(0);
    });
  });
}
