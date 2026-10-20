import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
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

async function highlightQuote(page: Page): Promise<string> {
  await highlightWith(page, 'Amarillo');
  return quoteText(page);
}

test('a backward drag from page 2 up into page 1 highlights only the pressed page', async ({
  page,
}) => {
  const from = await centreOf(lineSpan(pageAt(page, 1), 'GOLF'));
  const to = await centreOf(lineSpan(pageAt(page, 0), 'ECHO'));
  await drag(page, from, to);
  const quote = await highlightQuote(page);
  await expect(pageAt(page, 0).locator('.pdf-page__highlight')).toHaveCount(0);
  expect(await pageAt(page, 1).locator('.pdf-page__highlight').count()).toBeGreaterThanOrEqual(2);
  expect(quote).toContain('FOXTROT');
  expect(quote).toContain('GOLF');
  for (const word of ['ALPHA', 'ECHO', 'line of text']) expect(quote).not.toContain(word);
});

async function clientRectOfText(pdfPage: Locator, sentinel: string, word: string): Promise<Point> {
  return pdfPage
    .locator('.textLayer span[role="presentation"]', { hasText: sentinel })
    .evaluate((el, w) => {
      const node = el.firstChild as Text;
      const i = node.data.indexOf(w);
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + w.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, word);
}

test('a backward drag from the middle of a page 2 line stops at the anchor, not the line end', async ({
  page,
}) => {
  const from = await clientRectOfText(pageAt(page, 1), 'GOLF', 'second');
  const to = await centreOf(lineSpan(pageAt(page, 0), 'ECHO'));
  await drag(page, from, to);
  const quote = await highlightQuote(page);
  expect(quote).toContain('FOXTROT');
  expect(quote).toContain('GOLF');
  expect(quote).not.toContain('second line');
  expect(quote).not.toContain('ECHO');
});

test('a forward drag from page 1 into page 2 highlights only page 1', async ({ page }) => {
  const from = await centreOf(lineSpan(pageAt(page, 0), 'DELTA'));
  const to = await centreOf(lineSpan(pageAt(page, 1), 'GOLF'));
  await drag(page, from, to);
  const quote = await highlightQuote(page);
  await expect(pageAt(page, 1).locator('.pdf-page__highlight')).toHaveCount(0);
  expect(quote).toContain('ECHO fifth line of text');
  expect(quote).not.toContain('BRAVO');
  for (const word of ['FOXTROT', 'GOLF']) expect(quote).not.toContain(word);
});

test('a drag that starts on page 2, goes up into page 1 and back down behaves as page 2 only', async ({
  page,
}) => {
  const from = await centreOf(lineSpan(pageAt(page, 1), 'FOXTROT'));
  const up = await centreOf(lineSpan(pageAt(page, 0), 'ECHO'));
  const back = await centreOf(lineSpan(pageAt(page, 1), 'GOLF'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(up.x, up.y, { steps: 15 });
  await page.mouse.move(back.x, back.y, { steps: 15 });
  await page.mouse.up();
  const quote = await highlightQuote(page);
  await expect(pageAt(page, 0).locator('.pdf-page__highlight')).toHaveCount(0);
  expect(quote).toContain('first line GOLF');
  expect(quote).not.toContain('ECHO');
});

test('a triple click on a page 2 line highlights that line only', async ({ page }) => {
  const at = await centreOf(lineSpan(pageAt(page, 1), 'GOLF'));
  await page.mouse.click(at.x, at.y, { clickCount: 3 });
  const quote = await highlightQuote(page);
  expect(quote).toContain('GOLF');
  for (const word of ['FOXTROT', 'ECHO']) expect(quote).not.toContain(word);
});

test('a double click selects a single word', async ({ page }) => {
  const at = await clientRectOfText(pageAt(page, 1), 'FOXTROT', 'first');
  await page.mouse.dblclick(at.x, at.y);
  const quote = await highlightQuote(page);
  expect(quote.trim()).toBe('first');
});
