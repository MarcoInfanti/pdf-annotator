import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  boxOf,
  centreOf,
  drag,
  highlightWith,
  lineSpan,
  openFixture,
  pageAt,
  quoteText,
} from './fixtures/pdf-page-helpers';
import type { Point } from './fixtures/pdf-page-helpers';

test.beforeEach(({ page }) => openFixture(page));

async function dragAndHighlight(page: Page, from: Point, to: Point, via?: Point): Promise<string> {
  await drag(page, from, to, via);
  await highlightWith(page, 'Amarillo');
  return quoteText(page);
}

function expectNone(quote: string, words: string[]): void {
  for (const word of words) expect(quote).not.toContain(word);
}

test('drag across a line break, ending on text', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
  const to = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  const quote = await dragAndHighlight(page, from, to);
  await expect(pageAt(page, 0).locator('.pdf-page__highlight')).toHaveCount(2);
  expect(quote).toContain('text BRAVO');
  expectNone(quote, ['ALPHA', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']);
});

test('drag ending in the right margin', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
  const bravo = await boxOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  const charlie = await boxOf(lineSpan(pageAt(page, 0), 'CHARLIE'));
  const to = { x: bravo.x + bravo.width + 60, y: bravo.y + bravo.height / 2 };
  // Goes over the BRAVO text first: Chrome keeps the last text position over user-select:none.
  const via = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  const quote = await dragAndHighlight(page, from, to, via);
  expect(quote).toContain('BRAVO');
  expectNone(quote, ['CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']);
  for (const box of await pageAt(page, 0).locator('.pdf-page__highlight').all()) {
    const rect = await boxOf(box);
    expect(rect.y + rect.height).toBeLessThanOrEqual(charlie.y + 0.5);
  }
});

test('drag ending in the gap between two lines', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
  const bravo = await boxOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  const charlie = await boxOf(lineSpan(pageAt(page, 0), 'CHARLIE'));
  const to = { x: bravo.x + bravo.width / 2, y: (bravo.y + bravo.height + charlie.y) / 2 };
  const quote = await dragAndHighlight(page, from, to);
  expectNone(quote, ['DELTA', 'ECHO', 'FOXTROT']);
  expect(await pageAt(page, 0).locator('.pdf-page__highlight').count()).toBeLessThanOrEqual(3);
});

test('drag from page 1 into page 2 highlights only page 1', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'ECHO'));
  const to = await centreOf(lineSpan(pageAt(page, 1), 'FOXTROT'));
  const quote = await dragAndHighlight(page, from, to);
  await expect(pageAt(page, 1).locator('.pdf-page__highlight')).toHaveCount(0);
  expect(await pageAt(page, 0).locator('.pdf-page__highlight').count()).toBeGreaterThanOrEqual(1);
  expect(quote).toContain('line of text');
  expectNone(quote, ['FOXTROT', 'page two']);
});

test('the end-of-content marker is reset after the drag', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
  const to = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  await drag(page, from, to);
  await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
  await expect(pageAt(page, 0).locator('.textLayer > .endOfContent:last-child')).toHaveCount(1);
});

test('click behaviour is preserved', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'ALPHA'));
  const to = await centreOf(lineSpan(pageAt(page, 0), 'BRAVO'));
  await dragAndHighlight(page, from, to);
  const selected = page.locator('.pdf-page__highlight--selected');
  const pageBox = await boxOf(pageAt(page, 0));
  const echo = await boxOf(lineSpan(pageAt(page, 0), 'ECHO'));
  await page.mouse.click(pageBox.x + pageBox.width - 10, echo.y + echo.height + 15);
  await expect(page.getByRole('toolbar', { name: 'Subrayar selección' })).toBeHidden();
  await expect(selected).toHaveCount(0);
  const first = await centreOf(pageAt(page, 0).locator('.pdf-page__highlight').first());
  await page.mouse.click(first.x, first.y);
  await expect(selected.first()).toBeVisible();
});

test('a plain click on text opens no popup', async ({ page }) => {
  const point = await centreOf(lineSpan(pageAt(page, 0), 'CHARLIE'));
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('toolbar', { name: 'Subrayar selección' })).toBeHidden();
});
