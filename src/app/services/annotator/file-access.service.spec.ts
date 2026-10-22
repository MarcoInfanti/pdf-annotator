import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FilePickerWindow } from '../../models/annotator.model';
import { FileAccessService } from './file-access.service';

describe('FileAccessService', () => {
  const win = window as FilePickerWindow;
  const original = win.showOpenFilePicker;
  let service: FileAccessService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(FileAccessService);
  });

  afterEach(() => {
    win.showOpenFilePicker = original;
    jasmine.clock().uninstall();
  });

  it('download clicks an anchor named after the file and revokes the URL after 1000 ms', () => {
    jasmine.clock().install();
    const anchors: HTMLAnchorElement[] = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      anchors.push(this);
    });
    spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    const revoke = spyOn(URL, 'revokeObjectURL');

    service.download('{}', 'notes.json', 'application/json');

    expect(anchors.length).toBe(1);
    expect(anchors[0].download).toBe('notes.json');
    expect(revoke).not.toHaveBeenCalled();
    jasmine.clock().tick(1000);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });

  it('pickPdf returns the name, bytes and handle of the chosen file', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'book.pdf');
    const handle = { getFile: () => Promise.resolve(file) } as unknown as FileSystemFileHandle;
    win.showOpenFilePicker = () => Promise.resolve([handle]);

    const picked = await service.pickPdf();

    expect(picked?.name).toBe('book.pdf');
    expect(Array.from(picked?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(picked?.handle).toBe(handle);
  });

  it('pickPdf returns null when the user cancels the picker', async () => {
    win.showOpenFilePicker = () => Promise.reject(new DOMException('', 'AbortError'));

    expect(await service.pickPdf()).toBeNull();
  });

  it('pickPdf rethrows any other error', async () => {
    win.showOpenFilePicker = () => Promise.reject(new Error('boom'));

    await expectAsync(service.pickPdf()).toBeRejectedWithError('boom');
  });
});
