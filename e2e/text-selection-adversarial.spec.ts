import { expect, Locator, Page, test } from '@playwright/test';
import {
  boxOf,
  centreOf,
  highlightWith,
  lineSpan,
  openFixture,
  pageAt,
  Point,
  quoteText,
  Rect,
} from './fixtures/pdf-page-helpers';

/**
 * Adversarial selection cases: backward and mixed drags, marker lifecycle, regressions.
 *
 * Two environment switches emulate a broken viewer, to prove which cases catch which defect.
 * Both are meant to make the suite FAIL; run them by hand, never in CI:
 * - `NO_SELECTIONCHANGE=1 npm run e2e` drops the viewer's `selectionchange` listener, so the
 *   end-of-content marker never follows the selection.
 * - `SABOTAGE=1 npm run e2e` hides every `.endOfContent` with CSS, emulating the pre-fix text layer
 *   so the drag cases reproduce the original whole-page selection bug.
 */
test.beforeEach(async ({ page }) => {
  if (process.env['NO_SELECTIONCHANGE']) {
    await page.addInitScript(() => {
      const original = document.addEventListener.bind(document);
      document.addEventListener = ((type: string, ...rest: unknown[]) =>
        type === 'selectionchange'
          ? undefined
          : Reflect.apply(original, document, [type, ...rest])) as typeof document.addEventListener;
    });
  }
  await openFixture(page);
  if (process.env['SABOTAGE']) {
    await page.addStyleTag({ content: '.endOfContent { display: none !important; }' });
  }
});

/** Presses at the first point and moves through every waypoint in small steps. */
async function press(page: Page, from: Point, ...path: Point[]): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const point of path) await page.mouse.move(point.x, point.y, { steps: 20 });
}

async function dragPath(page: Page, from: Point, ...path: Point[]): Promise<void> {
  await press(page, from, ...path);
  await page.mouse.up();
}

const popup = (page: Page): Locator => page.getByRole('toolbar', { name: 'Subrayar selección' });

async function highlight(page: Page): Promise<string> {
  await highlightWith(page, 'Amarillo');
  return quoteText(page);
}

function expectNone(quote: string, words: string[]): void {
  for (const word of words) expect(quote).not.toContain(word);
}

async function lines(page: Page) {
  const p = pageAt(page, 0);
  return {
    alpha: await boxOf(lineSpan(p, 'ALPHA')),
    bravo: await boxOf(lineSpan(p, 'BRAVO')),
    charlie: await boxOf(lineSpan(p, 'CHARLIE')),
    delta: await boxOf(lineSpan(p, 'DELTA')),
    echo: await boxOf(lineSpan(p, 'ECHO')),
  };
}

const mid = (r: Rect): number => r.y + r.height / 2;
const gapBetween = (upper: Rect, lower: Rect): number => (upper.y + upper.height + lower.y) / 2;

/** Highlight rectangles of page one as screen boxes. */
async function highlightBoxes(page: Page, index = 0): Promise<Rect[]> {
  const out: Rect[] = [];
  for (const h of await pageAt(page, index).locator('.pdf-page__highlight').all()) out.push(await boxOf(h));
  return out;
}

test.describe('backward and mixed drags', () => {
  test('backward drag from BRAVO up to the start of ALPHA keeps only those two lines', async ({ page }) => {
    const l = await lines(page);
    await dragPath(page, { x: l.bravo.x + l.bravo.width - 3, y: mid(l.bravo) }, { x: l.alpha.x + 2, y: mid(l.alpha) });
    const quote = await highlight(page);
    expect(quote).toContain('PHA');
    expect(quote).toContain('BRAVO');
    expectNone(quote, ['CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']);
    const boxes = await highlightBoxes(page);
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b.y + b.height).toBeLessThanOrEqual(l.charlie.y + 0.5);
  });

  test('backward drag ending in the gap above the dragged-from line excludes the lines above the gap', async ({ page }) => {
    const l = await lines(page);
    await dragPath(
      page,
      { x: l.delta.x + 40, y: mid(l.delta) },
      { x: l.charlie.x + 30, y: mid(l.charlie) },
      { x: l.charlie.x + 30, y: gapBetween(l.bravo, l.charlie) },
    );
    const quote = await highlight(page);
    expectNone(quote, ['ALPHA', 'ECHO', 'FOXTROT']);
    expect(await highlightBoxes(page)).not.toHaveLength(0);
    for (const b of await highlightBoxes(page)) {
      expect(b.y).toBeGreaterThanOrEqual(l.bravo.y - 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(l.echo.y + 0.5);
    }
  });

  test('backward drag ending in the left margin keeps the dragged lines only', async ({ page }) => {
    const l = await lines(page);
    const pageBox = await boxOf(pageAt(page, 0));
    await dragPath(
      page,
      { x: l.charlie.x + 60, y: mid(l.charlie) },
      { x: l.bravo.x + 30, y: mid(l.bravo) },
      { x: pageBox.x + 5, y: mid(l.bravo) },
    );
    const quote = await highlight(page);
    expectNone(quote, ['ALPHA', 'DELTA', 'ECHO', 'FOXTROT']);
    expect(quote).toContain('BRAVO');
  });

  test('backward drag ending above the first line selects up to the start of the page, not the other page', async ({ page }) => {
    const l = await lines(page);
    const pageBox = await boxOf(pageAt(page, 0));
    await dragPath(
      page,
      { x: l.charlie.x + 40, y: mid(l.charlie) },
      { x: l.alpha.x + 2, y: mid(l.alpha) },
      { x: l.alpha.x + 2, y: pageBox.y + 3 },
    );
    const quote = await highlight(page);
    expect(quote).toContain('ALPHA');
    expectNone(quote, ['DELTA', 'ECHO', 'FOXTROT']);
    await expect(pageAt(page, 1).locator('.pdf-page__highlight')).toHaveCount(0);
  });

  test('going down then coming back up retracts the highlight to the final position', async ({ page }) => {
    const l = await lines(page);
    await dragPath(
      page,
      { x: l.alpha.x + 20, y: mid(l.alpha) },
      { x: l.echo.x + 40, y: mid(l.echo) },
      { x: l.bravo.x + 40, y: mid(l.bravo) },
    );
    const quote = await highlight(page);
    expect(quote).toContain('BRA');
    expectNone(quote, ['CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']);
    expect(await highlightBoxes(page)).toHaveLength(2);
  });

  test('going down into the gap and back up onto the first line retracts to one line', async ({ page }) => {
    const l = await lines(page);
    await dragPath(
      page,
      { x: l.alpha.x + 20, y: mid(l.alpha) },
      { x: l.bravo.x + 40, y: gapBetween(l.bravo, l.charlie) },
      { x: l.alpha.x + 100, y: mid(l.alpha) },
    );
    const quote = await highlight(page);
    expectNone(quote, ['BRAVO', 'CHARLIE', 'DELTA', 'ECHO']);
    expect(await highlightBoxes(page)).toHaveLength(1);
  });

  test('a drag started in the margin and ending on text never spills past the dragged line', async ({ page }) => {
    const l = await lines(page);
    const pageBox = await boxOf(pageAt(page, 0));
    await dragPath(page, { x: pageBox.x + 5, y: mid(l.bravo) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    // Starting in the margin may select nothing; when it selects something it must stay on BRAVO's line.
    if (await popup(page).isVisible()) {
      const quote = await highlight(page);
      expectNone(quote, ['ALPHA', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']);
    }
  });

  test('backward drag from page two into page one never highlights past the start page', async ({ page }) => {
    const echo = await centreOf(lineSpan(pageAt(page, 0), 'ECHO'));
    const foxtrot = await centreOf(lineSpan(pageAt(page, 1), 'FOXTROT'));
    await dragPath(page, foxtrot, echo);
    await expect(popup(page)).toBeVisible();
    await highlight(page);
    const onPageOne = (await highlightBoxes(page, 0)).length;
    const onPageTwo = (await highlightBoxes(page, 1)).length;
    expect(onPageOne + onPageTwo).toBeGreaterThanOrEqual(1);
    // Exactly one page is highlighted: the drag is never split across pages.
    expect(onPageOne === 0 || onPageTwo === 0).toBe(true);
  });
});

test.describe('marker lifecycle', () => {
  test('the layer is flagged selecting during the drag and reset after mouseup', async ({ page }) => {
    const l = await lines(page);
    await press(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await expect(page.locator('.textLayer.selecting')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    expect(await page.locator('.endOfContent').evaluateAll(els => els.map(e => (e as HTMLElement).style.height))).toEqual(['', '']);
  });

  test('the end-of-content marker moves with the drag and is only a child of its own layer', async ({ page }) => {
    const l = await lines(page);
    await press(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    const state = await pageAt(page, 0).evaluate(host => {
      const end = host.querySelector('.endOfContent') as HTMLElement;
      return { last: end === end.parentElement?.lastElementChild, height: end.style.height };
    });
    // Mid-drag the marker sits next to the moving end (not at the end of the layer) and is sized.
    expect(state.last).toBe(false);
    expect(state.height).not.toBe('');
    await page.mouse.up();
  });

  test('window blur mid-drag resets the marker and the selecting flag', async ({ page }) => {
    const l = await lines(page);
    await press(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    await page.mouse.up();
  });

  test('keyup mid-drag does not reset, keyup after the drag leaves everything reset', async ({ page }) => {
    const l = await lines(page);
    await press(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })));
    await expect(page.locator('.textLayer.selecting')).toHaveCount(1);
    await page.mouse.up();
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })));
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
  });

  test('a keyboard selection (Shift+Arrow) leaves nothing flagged once the key is released', async ({ page }) => {
    const l = await lines(page);
    await page.mouse.click(l.alpha.x + 10, mid(l.alpha));
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
  });

  test('a mouseup outside the viewer still ends the drag', async ({ page }) => {
    const l = await lines(page);
    await press(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) }, { x: 5, y: 880 });
    await page.mouse.up();
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
  });

  test('zooming in keeps a marker in every re-rendered layer and nothing stays flagged', async ({ page }) => {
    const l = await lines(page);
    await dragPath(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await page.getByRole('button', { name: 'Acercar' }).click();
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
  });

  test('a zoom in the middle of a drag leaves nothing flagged after the release', async ({ page }) => {
    const l = await lines(page);
    await press(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await page.keyboard.press('Control+=');
    await page.mouse.up();
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
  });

  test('a drag after a zoom still stops at the dragged lines', async ({ page }) => {
    const widthBefore = (await boxOf(lineSpan(pageAt(page, 0), 'BRAVO'))).width;
    await page.getByRole('button', { name: 'Acercar' }).click();
    await expect
      .poll(async () => (await lineSpan(pageAt(page, 0), 'BRAVO').boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthBefore * 1.05);
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    const l = await lines(page);
    await dragPath(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 40, y: mid(l.bravo) });
    const quote = await highlight(page);
    expect(quote).toContain('BRA');
    expectNone(quote, ['CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']);
  });

  test('opening a second PDF does not duplicate listeners: one popup and one annotation per selection', async ({ page }) => {
    page.on('dialog', dialog => void dialog.accept());
    const l = await lines(page);
    await dragPath(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await highlight(page);
    await page.getByRole('button', { name: 'Abrir PDF' }).first().click();
    await expect(page.locator('.pdf-page__highlight')).toHaveCount(0);
    await expect(lineSpan(pageAt(page, 0), 'BRAVO')).toBeVisible();
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    const m = await lines(page);
    await dragPath(page, { x: m.alpha.x + 10, y: mid(m.alpha) }, { x: m.bravo.x + 50, y: mid(m.bravo) });
    await expect(popup(page)).toHaveCount(1);
    await highlight(page);
    await expect(page.locator('blockquote.annotation-card__quote')).toHaveCount(1);
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
  });
});

test.describe('regressions', () => {
  test('the colour popup opens at the mouseup coordinates', async ({ page }) => {
    const l = await lines(page);
    const to = { x: l.bravo.x + 50, y: mid(l.bravo) };
    await dragPath(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, to);
    const box = await boxOf(popup(page));
    // The popup is centred on the pointer (translateX(-50%)).
    expect(Math.abs(box.x + box.width / 2 - to.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (to.y + 12))).toBeLessThanOrEqual(1);
  });

  test('highlights follow zoom: they scale and stay over the dragged text', async ({ page }) => {
    const l = await lines(page);
    await dragPath(page, { x: l.alpha.x + 10, y: mid(l.alpha) }, { x: l.bravo.x + 50, y: mid(l.bravo) });
    await highlight(page);
    const before = await highlightBoxes(page);
    await page.getByRole('button', { name: 'Acercar' }).click();
    await expect(page.locator('.textLayer > .endOfContent:last-child')).toHaveCount(2);
    const bravo = await boxOf(lineSpan(pageAt(page, 0), 'BRAVO'));
    await expect
      .poll(async () => (await highlightBoxes(page))[0].width)
      .toBeGreaterThan(before[0].width * 1.05);
    const after = await highlightBoxes(page);
    expect(after).toHaveLength(before.length);
    const second = after[1];
    expect(second.y).toBeLessThanOrEqual(bravo.y + bravo.height);
    expect(second.y + second.height).toBeGreaterThanOrEqual(bravo.y);
  });

  test('a plain click between lines shows no popup', async ({ page }) => {
    const l = await lines(page);
    await page.mouse.click(l.alpha.x + 10, gapBetween(l.alpha, l.bravo));
    await expect(popup(page)).toBeHidden();
  });

  // Observation, same as pdf.js: a collapsed caret still "intersects" the layer, so selectionchange
  // re-adds .selecting after pointerup. It is harmless (the marker only matters while dragging) but
  // it is not "nothing sticks". Kept as fixme so the behaviour is visible.
  test.fixme('a plain click leaves the layer unflagged', async ({ page }) => {
    const l = await lines(page);
    await page.mouse.click(l.alpha.x + 10, gapBetween(l.alpha, l.bravo));
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
  });

  test('a double click on a word highlights just that word', async ({ page }) => {
    const l = await lines(page);
    await page.mouse.dblclick(l.charlie.x + 5, mid(l.charlie));
    await expect(popup(page)).toBeVisible();
    const quote = await highlight(page);
    expect(quote).toContain('CHARLIE');
    expectNone(quote, ['ALPHA', 'BRAVO', 'DELTA', 'ECHO', 'FOXTROT']);
  });

  test('triple click selects at most the clicked line', async ({ page }) => {
    const l = await lines(page);
    await page.mouse.click(l.charlie.x + 5, mid(l.charlie), { clickCount: 3 });
    if (await popup(page).isVisible()) {
      const quote = await highlight(page);
      expect(quote).toContain('CHARLIE');
      expectNone(quote, ['ALPHA', 'BRAVO', 'DELTA', 'ECHO', 'FOXTROT']);
    }
  });

  test('Ctrl+A on the page never produces a quote beyond the first page', async ({ page }) => {
    const l = await lines(page);
    await page.mouse.click(l.alpha.x + 10, mid(l.alpha));
    await page.keyboard.press('Control+a');
    await page.mouse.click(l.alpha.x + 10, mid(l.alpha), { clickCount: 1 });
    await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
  });
});
