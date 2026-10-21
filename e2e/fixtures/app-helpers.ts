import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildSelectionFixture } from './selection-fixture';
import { centreOf, drag, highlightWith, lineSpan, pageAt } from './pdf-page-helpers';
import type { HighlightColorId } from './pdf-page-helpers';

/** Answer of the stub's `queryPermission` / `requestPermission`. */
export type PermissionResult = 'granted' | 'denied' | 'prompt';

/** Shape of the stubbed file system the init script keeps on `window`. */
export interface FsState {
  /** Bytes of the "file on disk" (what `getFile()` returns next). */
  bytes: number[];
  /** How many times `createWritable().close()` committed a write. */
  writes: number;
  /** How many times the open picker was called. */
  pickerCalls: number;
  /** The options each picker call received, in order. */
  pickerOptions: Record<string, unknown>[];
  /** How many times `createWritable()` was called, failed attempts included. */
  writeAttempts: number;
  /** Writes started and not yet committed. */
  activeWrites: number;
  /** Highest value `activeWrites` ever reached: more than 1 means two writes overlapped. */
  maxConcurrentWrites: number;
  /** How many times the app asked the browser to show the permission prompt. */
  requestPermissionCalls: number;
  /** What `queryPermission` answers now; switch it to simulate a revoked permission. */
  query: PermissionResult;
  /** What `requestPermission` answers (a grant also makes `query` answer granted). */
  request: PermissionResult;
  /** Milliseconds the permission prompt stays unanswered (page timers, so `page.clock` drives it). */
  requestDelayMs: number;
  /** Milliseconds a write stays open before it commits (page timers, so `page.clock` drives it). */
  writeDelayMs: number;
  /** How many of the next `createWritable()` calls reject. */
  failWrites: number;
  /** When true, `getFile()` rejects. */
  failGetFile: boolean;
  /** When true, `getFile()` starts rejecting once the next write has committed. */
  failGetFileAfterWrite: boolean;
  /** Name `getFile()` reports. */
  name: string;
  /** `lastModified` `getFile()` reports; every committed write advances it. */
  lastModified: number;
}

/** What a test may change on the stub while it runs. */
export type FsPatch = Partial<
  Pick<
    FsState,
    | 'query'
    | 'request'
    | 'writeDelayMs'
    | 'requestDelayMs'
    | 'failWrites'
    | 'failGetFile'
    | 'failGetFileAfterWrite'
    | 'name'
    | 'bytes'
    | 'lastModified'
  >
>;

export interface OpenOptions {
  /** Offer a writable handle (Chrome) or remove `showOpenFilePicker` (Firefox/Safari path). */
  handle?: boolean;
  /** File name reported by the picker. */
  name?: string;
  /** Bytes to serve; defaults to the two-page selection fixture. */
  bytes?: Uint8Array;
  /**
   * Autosave preference stored before the app starts, only when none is stored yet. The manual
   * flow suites assert a save only when asked, so the default is off; `'default'` stores nothing
   * and lets the app use its own default (on).
   */
  autosave?: boolean | 'default';
  /**
   * `'absent'` removes `queryPermission` / `requestPermission` from the handle (a browser without
   * them); otherwise the answers the stub starts with. Both default to granted.
   */
  permission?: 'absent' | { query?: PermissionResult; request?: PermissionResult };
  /** Milliseconds each write stays open before it commits. */
  writeDelayMs?: number;
  /** Milliseconds the permission prompt stays unanswered. */
  requestDelayMs?: number;
  /** localStorage entries to seed, only for keys not stored yet (so a reload keeps what it wrote). */
  storage?: Record<string, string>;
  /** `lastModified` the file starts with; carry it over to reopen a file the app already wrote. */
  lastModified?: number;
}

/**
 * Installs a stub File System Access API that keeps the written bytes, so a save followed by
 * "open again" reads back exactly what the app wrote. With `handle: false` the API is removed
 * and the app falls back to an `<input type=file>` (use the `filechooser` event).
 */
export async function installFileSystem(page: Page, options: OpenOptions = {}): Promise<void> {
  const bytes = options.bytes ?? (await buildSelectionFixture());
  const permission = options.permission ?? {};
  const answers = permission === 'absent' ? {} : permission;
  const config = {
    data: Array.from(bytes),
    name: options.name ?? 'fixture.pdf',
    handle: options.handle ?? true,
    autosave: options.autosave ?? false,
    permissionApi: permission !== 'absent',
    query: answers.query ?? 'granted',
    request: answers.request ?? 'granted',
    writeDelayMs: options.writeDelayMs ?? 0,
    requestDelayMs: options.requestDelayMs ?? 0,
    storage: options.storage ?? {},
    lastModified: options.lastModified ?? 1_700_000_000_000,
  };
  await page.addInitScript((cfg: typeof config) => {
    const seed = (key: string, value: string): void => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    };
    if (cfg.autosave !== 'default') seed('pdf-annotations.autosave', String(cfg.autosave));
    Object.entries(cfg.storage).forEach(([key, value]) => seed(key, value));
    const state = {
      bytes: cfg.data,
      writes: 0,
      pickerCalls: 0,
      pickerOptions: [] as Record<string, unknown>[],
      writeAttempts: 0,
      activeWrites: 0,
      maxConcurrentWrites: 0,
      requestPermissionCalls: 0,
      query: cfg.query,
      request: cfg.request,
      writeDelayMs: cfg.writeDelayMs,
      requestDelayMs: cfg.requestDelayMs,
      failWrites: 0,
      failGetFile: false,
      failGetFileAfterWrite: false,
      name: cfg.name,
      lastModified: cfg.lastModified,
    };
    Object.assign(window, { __fs: state });
    if (!cfg.handle) {
      Reflect.deleteProperty(window, 'showOpenFilePicker');
      return;
    }
    const handle: Record<string, unknown> = {
      getFile: () =>
        state.failGetFile
          ? Promise.reject(new Error('file unreadable'))
          : Promise.resolve(
              new File([new Uint8Array(state.bytes)], state.name, {
                type: 'application/pdf',
                lastModified: state.lastModified,
              }),
            ),
      createWritable: () => {
        state.writeAttempts += 1;
        if (state.failWrites > 0) {
          state.failWrites -= 1;
          // A slow disk fails slowly too: the failure arrives while the write is still in flight.
          return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('disk full')), state.writeDelayMs);
          });
        }
        state.activeWrites += 1;
        state.maxConcurrentWrites = Math.max(state.maxConcurrentWrites, state.activeWrites);
        let pending: number[] = [];
        return Promise.resolve({
          write: (chunk: Uint8Array) => {
            pending = Array.from(chunk);
            return Promise.resolve();
          },
          close: async () => {
            if (state.writeDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, state.writeDelayMs));
            }
            state.bytes = pending;
            state.writes += 1;
            if (state.failGetFileAfterWrite) state.failGetFile = true;
            state.lastModified += 1000;
            state.activeWrites -= 1;
          },
        });
      },
    };
    if (cfg.permissionApi) {
      handle['queryPermission'] = () => Promise.resolve(state.query);
      handle['requestPermission'] = async () => {
        state.requestPermissionCalls += 1;
        if (state.requestDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, state.requestDelayMs));
        }
        if (state.request === 'granted') state.query = 'granted';
        return state.request;
      };
    }
    Object.assign(window, {
      showOpenFilePicker: (pickerOptions: Record<string, unknown>) => {
        state.pickerCalls += 1;
        state.pickerOptions.push(pickerOptions);
        return Promise.resolve([handle]);
      },
    });
  }, config);
}

/** Reads the stub file system back. */
export function fsState(page: Page): Promise<FsState> {
  return page.evaluate(() => (window as unknown as { __fs: FsState }).__fs);
}

/** Changes the stub while the app runs: revoke the permission, make writes fail, slow them down. */
export function setFs(page: Page, patch: FsPatch): Promise<void> {
  return page.evaluate((changes) => {
    Object.assign((window as unknown as { __fs: FsState }).__fs, changes);
  }, patch);
}

/** The bytes the stub file holds now: the original ones until the app writes. */
export async function savedBytes(page: Page): Promise<Uint8Array> {
  return Uint8Array.from((await fsState(page)).bytes);
}

/** A localStorage value of the page, or null. */
export function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
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
