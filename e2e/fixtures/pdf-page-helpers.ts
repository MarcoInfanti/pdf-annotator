import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { buildSelectionFixture } from './selection-fixture';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/**
 * Stubs the file picker with the generated two-page fixture, opens it and waits until the
 * first line of each page (ALPHA, FOXTROT) is rendered in the text layer.
 */
export async function openFixture(page: Page): Promise<void> {
  const base64 = Buffer.from(await buildSelectionFixture()).toString('base64');
  await page.addInitScript((data: string) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'fixture.pdf', { type: 'application/pdf' });
    Object.assign(window, {
      showOpenFilePicker: () => Promise.resolve([{ getFile: () => Promise.resolve(file) }]),
    });
  }, base64);
  await page.goto('/');
  await page.getByTestId('annotator-toolbar-open').click();
  await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
  await expect(lineSpan(pageAt(page, 1), 'FOXTROT')).toBeVisible();
}

export function pageAt(page: Page, index: number): Locator {
  return page.getByTestId(`pdf-page-${index + 1}`);
}

export function lineSpan(pdfPage: Locator, sentinel: string): Locator {
  return pdfPage.locator('.textLayer span[role="presentation"]', { hasText: sentinel });
}

export async function boxOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

export async function centreOf(locator: Locator): Promise<Point> {
  const box = await boxOf(locator);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags in small steps, optionally passing over `via` first (like a hand does). */
export async function drag(page: Page, from: Point, to: Point, via?: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (via) await page.mouse.move(via.x, via.y, { steps: 20 });
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
}

/** Colour ids offered by the highlight popup (the `id` of each colour in the app). */
export type HighlightColorId = 'yellow' | 'green' | 'blue' | 'pink';

/** Picks `color` in the open highlight popup. */
export async function highlightWith(page: Page, color: HighlightColorId): Promise<void> {
  await page.getByTestId('highlight-popup').getByTestId(`highlight-popup-color-${color}`).click();
}

/** Text of the first annotation card quote in the side list. */
export function quoteText(page: Page): Promise<string> {
  return page.getByTestId('annotation-card-quote').first().innerText();
}
