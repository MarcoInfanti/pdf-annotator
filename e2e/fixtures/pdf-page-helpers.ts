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
  await page.getByRole('button', { name: 'Abrir PDF' }).first().click();
  await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
  await expect(lineSpan(pageAt(page, 1), 'FOXTROT')).toBeVisible();
}

export function pageAt(page: Page, index: number): Locator {
  return page.locator('app-pdf-page').nth(index);
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

export async function highlightWith(page: Page, color: string): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'Subrayar selección' })
    .getByRole('button', { name: `Subrayar en ${color}` })
    .click();
}

/** Text of the first annotation card quote in the side list. */
export function quoteText(page: Page): Promise<string> {
  return page.locator('blockquote.annotation-card__quote').first().innerText();
}
