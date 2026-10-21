import { expect, test } from '@playwright/test';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { fsState, openApp, savedBytes } from './fixtures/app-helpers';
import { annotationJson } from './fixtures/pdf-builders';

/**
 * Length of every page's /Contents array in a saved PDF (a lone stream counts as 1). pdf-lib wraps
 * the contents of a page it touches in a q ... Q pair, so an array that keeps growing between
 * saves means the file grows with every reopen.
 */
async function contentLengths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.lookup(PDFName.of('Contents'));
    return contents instanceof PDFArray ? contents.size() : 1;
  });
}

test.describe('page content streams across save and reopen cycles', () => {
  test('the /Contents of an annotated page does not gain wrapper streams on every cycle', async ({
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
      buffer: Buffer.from(annotationJson('88888888-8888-4888-8888-888888888888', 'x')),
    });
    const lengths: number[][] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      await page.getByTestId('annotator-toolbar-save').click();
      await expect.poll(async () => (await fsState(page)).writes).toBe(cycle + 1);
      await expect(page.getByTestId('annotator-toolbar-save')).toBeEnabled();
      lengths.push(await contentLengths(await savedBytes(page)));
      await page.getByTestId('annotator-toolbar-open').click();
      await expect.poll(async () => (await fsState(page)).pickerCalls).toBe(cycle + 2);
      await expect(page.getByTestId(/^annotation-card-[0-9a-f-]{36}$/)).toHaveCount(1);
    }
    expect(lengths.slice(1)).toEqual(Array(3).fill(lengths[0]));
  });
});
