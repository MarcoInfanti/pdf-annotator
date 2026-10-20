import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildSelectionFixture } from './selection-fixture';
import { centreOf, drag, highlightWith, lineSpan, pageAt } from './pdf-page-helpers';
import type { HighlightColorId } from './pdf-page-helpers';

/** Shape of the stubbed file system the init script keeps on `window`. */
export interface FsState {
  /** Bytes of the "file on disk" (what `getFile()` returns next). */
  bytes: number[];
  /** How many times `createWritable().close()` committed a write. */
  writes: number;
  /** How many times the open picker was called. */
  pickerCalls: number;
}

export interface OpenOptions {
  /** Offer a writable handle (Chrome) or remove `showOpenFilePicker` (Firefox/Safari path). */
  handle?: boolean;
  /** File name reported by the picker. */
  name?: string;
  /** Bytes to serve; defaults to the two-page selection fixture. */
  bytes?: Uint8Array;
}

/**
 * Installs a stub File System Access API that keeps the written bytes, so a save followed by
 * "open again" reads back exactly what the app wrote. With `handle: false` the API is removed
 * and the app falls back to an `<input type=file>` (use the `filechooser` event).
 */
export async function installFileSystem(page: Page, options: OpenOptions = {}): Promise<void> {
  const bytes = options.bytes ?? (await buildSelectionFixture());
  const config = {
    data: Array.from(bytes),
    name: options.name ?? 'fixture.pdf',
    handle: options.handle ?? true,
  };
  await page.addInitScript((cfg: typeof config) => {
    const state = { bytes: cfg.data, writes: 0, pickerCalls: 0 };
    Object.assign(window, { __fs: state });
    if (!cfg.handle) {
      Reflect.deleteProperty(window, 'showOpenFilePicker');
      return;
    }
    const handle = {
      getFile: () =>
        Promise.resolve(
          new File([new Uint8Array(state.bytes)], cfg.name, { type: 'application/pdf' }),
        ),
      createWritable: () => {
        let pending: number[] = [];
        return Promise.resolve({
          write: (chunk: Uint8Array) => {
            pending = Array.from(chunk);
            return Promise.resolve();
          },
          close: () => {
            state.bytes = pending;
            state.writes += 1;
            return Promise.resolve();
          },
        });
      },
    };
    Object.assign(window, {
      showOpenFilePicker: () => {
        state.pickerCalls += 1;
        return Promise.resolve([handle]);
      },
    });
  }, config);
}

/** Reads the stub file system back. */
export function fsState(page: Page): Promise<FsState> {
  return page.evaluate(() => (window as unknown as { __fs: FsState }).__fs);
}

/** Loads the app, opens the fixture through the stub and waits for both pages to render. */
export async function openApp(page: Page, options: OpenOptions = {}): Promise<void> {
  await installFileSystem(page, options);
  await page.goto('/');
  await page.getByTestId('annotator-toolbar-open').click();
  await expect(lineSpan(pageAt(page, 0), 'ALPHA')).toBeVisible();
  await expect(lineSpan(pageAt(page, 1), 'FOXTROT')).toBeVisible();
}

/** Selects from the start of one sentinel line to another on page 1 and picks `color`. */
export async function highlightLines(
  page: Page,
  from: string,
  to: string,
  color: HighlightColorId = 'yellow',
): Promise<void> {
  const start = await centreOf(lineSpan(pageAt(page, 0), from));
  const end = await centreOf(lineSpan(pageAt(page, 0), to));
  await drag(page, start, end);
  await highlightWith(page, color);
}

/** Types `text` in the open card editor and saves it with the Save button. */
export async function commentOn(page: Page, text: string): Promise<void> {
  await page.getByTestId('annotation-card-editor').fill(text);
  await page.getByTestId('annotation-card-save').click();
}

/** Every user-visible string: text nodes plus aria-label, title, placeholder and the tab title. */
export function collectUiStrings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [document.title];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const inPdfText = node.parentElement?.closest('.textLayer');
      const text = node.textContent?.trim();
      if (text && !inPdfText) out.push(text);
    }
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
        const value = el.getAttribute(attr);
        if (value) out.push(value);
      }
    }
    return out;
  });
}

/** Matches an untranslated key such as `TOOLBAR.OPEN` or `CARD.SAVE_TITLE`. */
const RAW_KEY = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\.[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b/;

/** Strings that look like an untranslated key. */
export async function rawKeysOnScreen(page: Page): Promise<string[]> {
  return (await collectUiStrings(page)).filter((text) => RAW_KEY.test(text));
}

/** Flattens a translation bundle to `{ 'TOOLBAR.OPEN': 'Open PDF' }`. */
function flatten(node: unknown, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  if (typeof node === 'string') return { [prefix]: node };
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    Object.assign(flat, flatten(value, prefix ? `${prefix}.${key}` : key));
  }
  return flat;
}

/** The bundle of `lang`, read from the repository (the app imports the same files). */
export function bundle(lang: 'es' | 'en'): Record<string, string> {
  const path = join(process.cwd(), 'src', 'assets', 'i18n', `${lang}.json`);
  return flatten(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Strings of the other language that show on screen. Only values with no placeholder that differ
 * between the bundles and are long enough not to collide with PDF or file names are compared.
 */
export async function foreignStringsOnScreen(page: Page, shown: 'es' | 'en'): Promise<string[]> {
  const own = bundle(shown);
  const other = bundle(shown === 'es' ? 'en' : 'es');
  const foreign = Object.entries(other)
    .filter(([key, value]) => value !== own[key] && !value.includes('{{') && value.length >= 4)
    .map(([key, value]) => ({ key, value }));
  const strings = (await collectUiStrings(page)).join('\n');
  return foreign
    .filter(
      ({ value }) =>
        strings.includes(value) && !Object.values(own).some((text) => text.includes(value)),
    )
    .map(({ key, value }) => `${key}: ${value}`);
}
