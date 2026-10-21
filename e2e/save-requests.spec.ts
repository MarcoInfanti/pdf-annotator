import { expect, test } from '@playwright/test';
import { commentOn, fsState, highlightLines, openApp, setFs } from './fixtures/app-helpers';

test.describe('repeated and overlapping save requests', () => {
  test('pressing Ctrl+S three times during a slow write writes once, never overlapping', async ({
    page,
  }) => {
    await page.clock.install();
    await openApp(page, { autosave: false, writeDelayMs: 1500 });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    for (let press = 0; press < 3; press++) await page.keyboard.press('Control+s');
    await page.clock.runFor(1500);
    await expect.poll(async () => (await fsState(page)).writes).toBe(1);
    await page.clock.runFor(5000);
    const state = await fsState(page);
    expect(state.writes).toBe(1);
    expect(state.writeAttempts).toBe(1);
    expect(state.maxConcurrentWrites).toBe(1);
    await expect(page.getByTestId('annotator-toolbar-saved')).toBeVisible();
  });

  test('opening another file while a slow autosave is writing waits for it, writes nothing twice and asks nothing', async ({
    page,
  }) => {
    await page.clock.install();
    await openApp(page, { autosave: true, writeDelayMs: 3000 });
    await highlightLines(page, 'ALPHA', 'BRAVO');
    await commentOn(page, 'x');
    await page.clock.runFor(3500);
    await expect(page.getByTestId('annotator-toolbar-saving')).toBeVisible();
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await setFs(page, { name: 'next.pdf' });
    await page.getByTestId('annotator-toolbar-open').click();
    await page.clock.runFor(3000);
    await expect(page.getByTestId('annotator-toolbar-file-name')).toContainText('next.pdf');
    await page.clock.runFor(10_000);
    const state = await fsState(page);
    expect(state.writes).toBe(1);
    expect(state.maxConcurrentWrites).toBe(1);
    expect(dialogs).toEqual([]);
  });
});
