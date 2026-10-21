import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  bundle,
  fsState,
  installFileSystem,
  openApp,
  readStorage,
  savedBytes,
} from './fixtures/app-helpers';
import type { OpenOptions } from './fixtures/app-helpers';
import {
  annotationJson,
  buildReadingFixture,
  positionIn,
  withEmbeddedPosition,
} from './fixtures/pdf-builders';
import type { ReadingFixtureOptions, StoredPosition } from './fixtures/pdf-builders';
import { boxOf, lineSpan, pageAt } from './fixtures/pdf-page-helpers';

const ES = bundle('es');
const NAME = 'reading.pdf';
const POSITION_KEY = `pdf-annotations.position.${NAME}|6`;
/** Page size in points before rotation, as built by `buildReadingFixture`. */
const PAGE_W = 400;
const PAGE_H = 600;
const ZOOM = 1.25;

const resumeBar = (page: Page) => page.getByTestId('annotator-resume');
const dirty = (page: Page) => page.getByTestId('annotator-toolbar-dirty');

/** Opens a reading fixture through the stub; the file is called `reading.pdf`. */
async function openReading(
  page: Page,
  fixture: ReadingFixtureOptions | Uint8Array = {},
  options: OpenOptions = {},
): Promise<void> {
  const bytes = fixture instanceof Uint8Array ? fixture : await buildReadingFixture(fixture);
  await installFileSystem(page, { bytes, name: NAME, ...options });
  await page.goto('/');
  await openAgain(page);
}

/** Clicks Open and waits for the first page text. */
async function openAgain(page: Page): Promise<void> {
  await page.getByTestId('annotator-toolbar-open').click();
  await expect(lineSpan(pageAt(page, 0), 'READING PAGE 1 top')).toBeVisible();
}

interface Geometry {
  scrollTop: number;
  clientHeight: number;
  pages: { top: number; height: number }[];
}

function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const host = document.querySelector('app-pdf-viewer')!;
    const pages = Array.from(host.querySelectorAll('app-pdf-page')).map((el) => ({
      top: (el as HTMLElement).offsetTop,
      height: (el as HTMLElement).offsetHeight,
    }));
    return { scrollTop: host.scrollTop, clientHeight: host.clientHeight, pages };
  });
}

async function scrollTop(page: Page): Promise<number> {
  return (await geometry(page)).scrollTop;
}

/** Waits until the viewer stops moving (a smooth scroll takes a few hundred ms). */
async function settleScroll(page: Page): Promise<number> {
  let last = Number.NaN;
  for (let i = 0; i < 40; i++) {
    const now = await scrollTop(page);
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

/** A real mouse wheel over the viewer: the user scrolling. */
async function wheel(page: Page, deltaY: number): Promise<number> {
  const box = await boxOf(page.locator('app-pdf-viewer'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  return settleScroll(page);
}

/** The position the app remembered for the fixture, or null. */
async function stored(page: Page): Promise<StoredPosition | null> {
  const raw = await readStorage(page, POSITION_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredPosition);
}

function position(page: number, y: number, updatedAt: string, x = 0): StoredPosition {
  return { page, x, y, zoom: 1, updatedAt };
}

/** Records every scroll offset the viewer reports from now on. */
function recordScrolls(page: Page): Promise<void> {
  return page.evaluate(() => {
    const host = document.querySelector('app-pdf-viewer')!;
    const samples: number[] = [];
    Object.assign(window, { __scrolls: samples });
    host.addEventListener('scroll', () => samples.push(host.scrollTop));
  });
}

function recordedScrolls(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __scrolls: number[] }).__scrolls);
}

/** Expected `{ x, y }` of the point `offset` CSS pixels below the top of an unrotated-or-rotated page. */
function expectedPoint(rotation: number, offset: number): { x: number; y: number } {
  const units = offset / ZOOM;
  switch (rotation) {
    case 90:
      return { x: units, y: 0 };
    case 180:
      return { x: PAGE_W, y: units };
    case 270:
      return { x: PAGE_W - units, y: PAGE_H };
    default:
      return { x: 0, y: PAGE_H - units };
  }
}

test.describe('when the position is recorded', () => {
  test('after 150 ms of stillness, restarting while the scrolling continues, and never marking the document dirty or writing the file', async ({
    page,
  }) => {
    await page.clock.install();
    await openReading(page, {}, { autosave: 'default' });
    expect(await stored(page)).toBeNull(); // opening and rendering is not reading
    await page.clock.pauseAt(new Date(Date.now() + 5000));

    await wheel(page, 700);
    await page.clock.runFor(100);
    expect(await stored(page)).toBeNull();
    await wheel(page, 300); // more scrolling restarts the wait
    await page.clock.runFor(100);
    expect(await stored(page)).toBeNull();
    await page.clock.runFor(100);
    const first = await stored(page);
    expect(first).not.toBeNull();
    expect(first?.page).toBeGreaterThanOrEqual(1);

    await page.clock.runFor(60_000);
    await expect(dirty(page)).toHaveCount(0);
    expect((await fsState(page)).writeAttempts).toBe(0);
  });

  test('a scroll the user did not cause is not recorded', async ({ page }) => {
    await openReading(page);
    await page.evaluate(() => {
      document.querySelector('app-pdf-viewer')!.scrollTop = 1500;
    });
    await settleScroll(page);
    await page.waitForTimeout(500);
    expect(await stored(page)).toBeNull();
  });

  test('a key press arms the tracker, so the next scroll is recorded', async ({ page }) => {
    await openReading(page);
    await page.keyboard.press('Shift');
    await page.evaluate(() => {
      document.querySelector('app-pdf-viewer')!.scrollTop = 1500;
    });
    await expect.poll(() => stored(page)).not.toBeNull();
  });

  test('a pointer press on the viewer arms the tracker, so the next scroll is recorded', async ({
    page,
  }) => {
    await openReading(page);
    const box = await boxOf(page.locator('app-pdf-viewer'));
    await page.mouse.click(box.x + 3, box.y + 3);
    await page.evaluate(() => {
      document.querySelector('app-pdf-viewer')!.scrollTop = 1500;
    });
    await expect.poll(() => stored(page)).not.toBeNull();
  });

  test('Ctrl + wheel zooms without counting as reading, and a toolbar zoom does not either', async ({
    page,
  }) => {
    await openReading(page);
    await page.evaluate(() => {
      const host = document.querySelector('app-pdf-viewer')!;
      host.dispatchEvent(
        new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.getByTestId('annotator-toolbar-zoom-select')).not.toHaveValue('1.25');
    await page.getByTestId('annotator-toolbar-zoom-in').click();
    await page.evaluate(() => {
      document.querySelector('app-pdf-viewer')!.scrollTop += 400;
    });
    await settleScroll(page);
    await page.waitForTimeout(500);
    expect(await stored(page)).toBeNull();
  });

  for (const rotation of [0, 90, 180, 270] as const) {
    test(`maps the scroll offset to the unrotated point on /Rotate ${rotation} pages`, async ({
      page,
    }) => {
      await openReading(page, { rotation });
      await wheel(page, 1500);
      await expect.poll(() => stored(page)).not.toBeNull();
      const [position, view] = [(await stored(page))!, await geometry(page)];
      const index = view.pages.findIndex((p) => view.scrollTop < p.top + p.height);
      const target = view.pages[index];
      const offset = Math.max(0, view.scrollTop - target.top);
      expect(position.page).toBe(index + 1);
      const expected = expectedPoint(rotation, offset);
      expect(position.x).toBeCloseTo(expected.x, 0);
      expect(position.y).toBeCloseTo(expected.y, 0);
      expect(position.zoom).toBe(ZOOM);
    });
  }

  test('a scroll that ends in the gap between two pages counts as the top of the next page', async ({
    page,
  }) => {
    await openReading(page);
    const box = await boxOf(page.locator('app-pdf-viewer'));
    await page.mouse.click(box.x + 3, box.y + 3);
    const view = await geometry(page);
    const gap = view.pages[1].top - 8; // pages sit 16 px apart
    await page.evaluate((top) => {
      document.querySelector('app-pdf-viewer')!.scrollTop = top;
    }, gap);
    await expect.poll(() => stored(page)).not.toBeNull();
    const position = (await stored(page))!;
    expect(position.page).toBe(2);
    expect(position.y).toBeCloseTo(PAGE_H, 0);
  });

  test('scrolled to the very end the position is the page under the top edge, inside the document', async ({
    page,
  }) => {
    await openReading(page);
    await wheel(page, 20_000);
    await expect.poll(() => stored(page)).not.toBeNull();
    const position = (await stored(page))!;
    const view = await geometry(page);
    const under = view.pages.findIndex((p) => view.scrollTop < p.top + p.height);
    expect(position.page).toBe(under + 1);
    expect(position.page).toBeGreaterThanOrEqual(5);
    expect(position.y).toBeLessThanOrEqual(PAGE_H);
    expect(position.y).toBeGreaterThanOrEqual(0);
  });

  test('a second document does not inherit the scroll of the first', async ({ page }) => {
    await openReading(page);
    await wheel(page, 1500);
    await expect.poll(() => stored(page)).not.toBeNull();
    const before = await readStorage(page, POSITION_KEY);
    await page.evaluate(() => {
      (window as unknown as { __fs: { name: string } }).__fs.name = 'other.pdf';
    });
    await openAgain(page);
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('other.pdf');
    await page.waitForTimeout(600);
    expect(await readStorage(page, 'pdf-annotations.position.other.pdf|6')).toBeNull();
    expect(await readStorage(page, POSITION_KEY)).toBe(before);
  });
});

test.describe('the resume offer', () => {
  test('appears on reopening a document left mid-way, as a labelled group, and is not the notice', async ({
    page,
  }) => {
    await openReading(page);
    await wheel(page, 1500);
    await expect.poll(() => stored(page)).not.toBeNull();
    const left = (await stored(page))!;
    await page.reload();
    await openAgain(page);
    await expect(resumeBar(page)).toBeVisible();
    await expect(resumeBar(page)).toHaveAttribute('role', 'group');
    await expect(resumeBar(page)).toHaveAttribute('aria-labelledby', 'annotator-resume-label');
    await expect(page.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', String(left.page)),
    );
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
    await expect(page.getByTestId('annotator-resume-dismiss')).toHaveAttribute(
      'aria-label',
      ES['NOTICE.RESUME_DISMISS'],
    );
  });

  test('is not offered when the document was left at the start', async ({ page }) => {
    await openReading(page);
    await page.reload();
    await openAgain(page);
    await expect(resumeBar(page)).toHaveCount(0);
  });

  test('"Ahora no" closes it for the session, and a later save does not bring it back', async ({
    page,
  }) => {
    await openReading(page);
    await wheel(page, 1500);
    await expect.poll(() => stored(page)).not.toBeNull();
    await page.reload();
    await openAgain(page);
    await page.getByTestId('annotator-resume-dismiss').click();
    await expect(resumeBar(page)).toHaveCount(0);
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    await expect(resumeBar(page)).toHaveCount(0);
  });

  test('"Continuar" smoothly lands on the saved spot, keeps the current zoom and closes the bar', async ({
    page,
  }) => {
    await openReading(page);
    await page.getByTestId('annotator-toolbar-zoom-in').click(); // 1.5, the position records it
    await expect(page.getByTestId('annotator-toolbar-zoom-select')).toHaveValue('1.5');
    const box = await boxOf(page.locator('app-pdf-viewer'));
    await page.mouse.click(box.x + 3, box.y + 3);
    await wheel(page, 1800);
    await expect.poll(async () => (await stored(page))?.zoom).toBe(1.5);
    const left = (await stored(page))!;
    await page.reload();
    await openAgain(page);
    await expect(page.getByTestId('annotator-toolbar-zoom-select')).toHaveValue('1.25');

    await recordScrolls(page);
    await page.getByTestId('annotator-resume-continue').click();
    await expect(resumeBar(page)).toHaveCount(0);
    await settleScroll(page);
    const samples = await recordedScrolls(page);
    const final = samples.at(-1) ?? 0;
    expect(new Set(samples.filter((s) => s > 0 && s < final)).size).toBeGreaterThanOrEqual(2); // it travelled
    await expect(page.getByTestId('annotator-toolbar-zoom-select')).toHaveValue('1.25');

    await expect.poll(() => stored(page).then((p) => p?.zoom)).toBe(1.25); // the settled landing
    const landed = (await stored(page))!;
    expect(landed.page).toBe(left.page);
    expect(Math.abs(landed.y - left.y)).toBeLessThanOrEqual(2);
  });

  test('under reduced motion "Continuar" jumps at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReading(page);
    await wheel(page, 1800);
    await expect.poll(() => stored(page)).not.toBeNull();
    const target = await scrollTop(page);
    await page.reload();
    await openAgain(page);
    await recordScrolls(page);
    await page.getByTestId('annotator-resume-continue').click();
    await expect(resumeBar(page)).toHaveCount(0);
    await settleScroll(page);
    const samples = await recordedScrolls(page);
    expect(new Set(samples).size).toBeLessThanOrEqual(2);
    expect(Math.abs((samples.at(-1) ?? 0) - target)).toBeLessThanOrEqual(2);
  });

  test('the sidebar jump to an annotation stays smooth even under reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReading(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        annotationJson('33333333-3333-4333-8333-333333333333', 'far away', 'q', 5),
      ),
    });
    await expect(page.getByTestId('annotation-card-page')).toBeVisible();
    await recordScrolls(page);
    await page.getByTestId('annotation-card-page').click();
    await settleScroll(page);
    const samples = await recordedScrolls(page);
    const final = samples.at(-1) ?? 0;
    expect(final).toBeGreaterThan(2000);
    expect(new Set(samples.filter((s) => s > 0 && s < final)).size).toBeGreaterThanOrEqual(2);
  });

  for (const rotation of [0, 90, 180, 270] as const) {
    test(`/Rotate ${rotation}: Continuar returns to the spot that was left, within 2 px`, async ({
      page,
    }) => {
      await openReading(page, { rotation });
      const left = await wheel(page, 1700);
      await expect.poll(() => stored(page)).not.toBeNull();
      await page.reload();
      await openAgain(page);
      await page.getByTestId('annotator-resume-continue').click();
      const landed = await settleScroll(page);
      expect(Math.abs(landed - left)).toBeLessThanOrEqual(2);
    });

    test(`/Rotate ${rotation}: scrolling back to the top leaves no offer on reopening`, async ({
      page,
    }) => {
      await openReading(page, { rotation });
      await wheel(page, 1700);
      await wheel(page, -10_000);
      await expect.poll(async () => (await stored(page))?.page).toBe(1);
      expect(await scrollTop(page)).toBe(0);
      await page.reload();
      await openAgain(page);
      await expect(resumeBar(page)).toHaveCount(0);
    });
  }

  test('a crop box away from the origin still counts the top of page 1 as the start', async ({
    page,
  }) => {
    await openReading(page, { cropBox: [20, 30, 300, 560] });
    await wheel(page, 1700);
    await wheel(page, -10_000);
    await expect.poll(async () => (await stored(page))?.page).toBe(1);
    await page.reload();
    await openAgain(page);
    await expect(resumeBar(page)).toHaveCount(0);
  });

  test('a position a few pixels below the top of page 1 is offered', async ({ page }) => {
    await openReading(page);
    const box = await boxOf(page.locator('app-pdf-viewer'));
    await page.mouse.click(box.x + 3, box.y + 3);
    await page.evaluate(() => {
      document.querySelector('app-pdf-viewer')!.scrollTop = 16 + 60;
    });
    await expect.poll(() => stored(page)).not.toBeNull();
    await page.reload();
    await openAgain(page);
    await expect(resumeBar(page)).toBeVisible();
  });
});

test.describe('where the position comes from', () => {
  const early = '2026-03-01T10:00:00.000Z';
  const late = '2026-03-01T10:00:01.000Z';

  async function embedded(page: number, updatedAt: string): Promise<Uint8Array> {
    return withEmbeddedPosition(await buildReadingFixture(), position(page, 300, updatedAt));
  }

  test('the position written in the PDF is offered when the browser remembers nothing', async ({
    page,
  }) => {
    await openReading(page, await embedded(3, early));
    await expect(page.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', '3'),
    );
  });

  test('the position remembered by the browser is offered when the PDF has none', async ({
    page,
  }) => {
    await openReading(
      page,
      {},
      { storage: { [POSITION_KEY]: JSON.stringify(position(5, 300, early)) } },
    );
    await expect(page.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', '5'),
    );
  });

  test('the newer one wins: the browser one', async ({ page }) => {
    await openReading(page, await embedded(3, early), {
      storage: { [POSITION_KEY]: JSON.stringify(position(5, 300, late)) },
    });
    await expect(page.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', '5'),
    );
  });

  test('the newer one wins: the PDF one', async ({ page }) => {
    await openReading(page, await embedded(3, late), {
      storage: { [POSITION_KEY]: JSON.stringify(position(5, 300, early)) },
    });
    await expect(page.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', '3'),
    );
  });

  test('a tie goes to the PDF', async ({ page }) => {
    await openReading(page, await embedded(3, early), {
      storage: { [POSITION_KEY]: JSON.stringify(position(5, 300, early)) },
    });
    await expect(page.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', '3'),
    );
  });

  for (const garbage of [
    'not json',
    '{"page":0,"x":1,"y":1,"zoom":1,"updatedAt":"2026-01-01"}',
    'null',
    '[]',
  ]) {
    test(`remembered data ${garbage} is ignored without breaking the open`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openReading(page, {}, { storage: { [POSITION_KEY]: garbage } });
      await expect(resumeBar(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('a position remembered for the same name with another page count is not offered', async ({
    page,
  }) => {
    await openReading(
      page,
      {},
      {
        storage: {
          [`pdf-annotations.position.${NAME}|7`]: JSON.stringify(position(5, 300, early)),
        },
      },
    );
    await expect(resumeBar(page)).toHaveCount(0);
  });

  test('the offer coexists with the encrypted-PDF notice and the recovery offer without overwriting them', async ({
    page,
  }) => {
    await openReading(page, await embedded(3, early), {
      storage: {
        [`pdf-annotations.recovery.${NAME}|6`]: JSON.stringify({
          baseline: { size: 1, lastModified: 1 },
          annotations: annotationJson('44444444-4444-4444-8444-444444444444', 'unsaved'),
        }),
      },
    });
    await expect(resumeBar(page)).toBeVisible();
    await expect(page.getByTestId('annotator-recovery')).toBeVisible();
    await expect(page.getByTestId('annotator-recovery')).toHaveAttribute('role', 'group');
    await expect(page.getByTestId('annotator-notice')).toHaveCount(0);
  });
});

test.describe('what is written into the PDF', () => {
  /** Marks the document dirty without selecting text: one annotation imported from JSON. */
  async function importOne(page: Page): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('annotator-toolbar-import-json').click();
    await (
      await chooser
    ).setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(annotationJson('55555555-5555-4555-8555-555555555555', 'x')),
    });
    await expect(dirty(page)).toBeVisible();
  }

  for (const rotation of [0, 90, 180, 270] as const) {
    test(`/Rotate ${rotation}: saving stores the position and an /OpenAction on the ${
      rotation === 90 || rotation === 270 ? 'x' : 'y'
    } axis`, async ({ page }) => {
      await openReading(page, { rotation });
      await wheel(page, 1700);
      await expect.poll(() => stored(page)).not.toBeNull();
      const remembered = (await stored(page))!;
      await importOne(page);
      await page.getByTestId('annotator-toolbar-save').click();
      await expect.poll(async () => (await fsState(page)).writes).toBe(1);

      const written = await positionIn(await savedBytes(page));
      expect(written.stored).toEqual(remembered);
      expect(written.openAction?.type).toBe('XYZ');
      expect(written.openAction?.pageIndex).toBe(remembered.page - 1);
      const [first, second, third] = written.openAction?.values ?? [];
      if (rotation === 90 || rotation === 270) {
        expect([first, second, third]).toEqual([remembered.x, null, null]);
      } else {
        expect([first, second, third]).toEqual([null, remembered.y, null]);
      }
    });
  }

  test('nothing is written when no position was captured: the original /OpenAction is left alone', async ({
    page,
  }) => {
    await openReading(page);
    await importOne(page);
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    const written = await positionIn(await savedBytes(page));
    expect(written).toEqual({ stored: null, openAction: null });
  });

  test('"Descargar copia" and an autosave carry the position too', async ({ page }) => {
    await openReading(page, {}, { autosave: true });
    await wheel(page, 1700);
    await expect.poll(() => stored(page)).not.toBeNull();
    const remembered = (await stored(page))!;
    await importOne(page);
    await expect.poll(async () => (await fsState(page)).writes, { timeout: 10_000 }).toBe(1);
    expect((await positionIn(await savedBytes(page))).stored).toEqual(remembered);

    const download = page.waitForEvent('download');
    await page.getByTestId('annotator-toolbar-save-copy').click();
    expect((await download).suggestedFilename()).toBe('reading-anotado.pdf');
  });

  test('a saved PDF reopened in a fresh browser profile offers the position written in it', async ({
    page,
    browser,
  }) => {
    await openReading(page);
    await wheel(page, 1700);
    await expect.poll(() => stored(page)).not.toBeNull();
    const remembered = (await stored(page))!;
    await importOne(page);
    await page.getByTestId('annotator-toolbar-save').click();
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    const bytes = await savedBytes(page);

    const fresh = await browser.newContext({ locale: 'es-ES' });
    const other = await fresh.newPage();
    await openReading(other, bytes);
    await expect(other.locator('#annotator-resume-label')).toHaveText(
      ES['NOTICE.RESUME'].replace('{{page}}', String(remembered.page)),
    );
    await fresh.close();
  });
});

test.describe('a remembered position outside the document', () => {
  test('beyond the page count it gives no resume offer and no error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page, {
      storage: {
        'pdf-annotations.position.fixture.pdf|2': JSON.stringify({
          page: 99,
          x: 0,
          y: 10,
          zoom: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });
    await expect(page.getByTestId('annotator-resume')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the last page still gets its offer', async ({ page }) => {
    await openApp(page, {
      storage: {
        'pdf-annotations.position.fixture.pdf|2': JSON.stringify({
          page: 2,
          x: 0,
          y: 10,
          zoom: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });
    await expect(page.getByTestId('annotator-resume')).toBeVisible();
  });
});
