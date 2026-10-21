import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FilePickerWindow, PermissionedFileHandle } from '../../models/annotator.model';
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

  /** A handle over a 3-byte file; the permission methods are optional, like in real browsers. */
  function fakeHandle(permissions: Partial<PermissionedFileHandle> = {}): PermissionedFileHandle {
    const file = new File([new Uint8Array([1, 2, 3])], 'book.pdf', { lastModified: 777 });
    return { getFile: () => Promise.resolve(file), ...permissions } as PermissionedFileHandle;
  }

  function pickerReturning(handle: PermissionedFileHandle): jasmine.Spy {
    const picker = jasmine.createSpy('showOpenFilePicker').and.resolveTo([handle]);
    win.showOpenFilePicker = picker as FilePickerWindow['showOpenFilePicker'];
    return picker;
  }

  it('pickPdf returns the name, bytes, handle and stamp of the chosen file', async () => {
    const handle = fakeHandle();
    pickerReturning(handle);

    const picked = await service.pickPdf();

    expect(picked?.name).toBe('book.pdf');
    expect(Array.from(picked?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(picked?.handle).toBe(handle);
    expect(picked?.stamp).toEqual({ size: 3, lastModified: 777 });
  });

  it('pickPdf opens read-only: the picker is not asked for read-write access', async () => {
    const picker = pickerReturning(fakeHandle());

    await service.pickPdf();

    expect(picker.calls.mostRecent().args[0]).not.toEqual(
      jasmine.objectContaining({ mode: jasmine.anything() }),
    );
  });

  describe('writeGranted (query only, never a prompt)', () => {
    it('is true when the browser has no permission methods', async () => {
      pickerReturning(fakeHandle());

      expect((await service.pickPdf())?.writeGranted).toBeTrue();
    });

    it('is true when the permission is already granted, without asking', async () => {
      const request = jasmine.createSpy().and.resolveTo('denied');
      pickerReturning(
        fakeHandle({
          queryPermission: () => Promise.resolve('granted'),
          requestPermission: request,
        }),
      );

      expect((await service.pickPdf())?.writeGranted).toBeTrue();
      expect(request).not.toHaveBeenCalled();
    });

    it('is false, and never prompts, when the permission is not granted yet', async () => {
      const request = jasmine.createSpy().and.resolveTo('granted');
      pickerReturning(
        fakeHandle({
          queryPermission: () => Promise.resolve('prompt'),
          requestPermission: request,
        }),
      );

      expect((await service.pickPdf())?.writeGranted).toBeFalse();
      expect(request).not.toHaveBeenCalled();
    });

    it('is false, and the open still succeeds, when the query is rejected', async () => {
      pickerReturning(fakeHandle({ queryPermission: () => Promise.reject(new Error('boom')) }));

      const picked = await service.pickPdf();

      expect(picked?.name).toBe('book.pdf');
      expect(picked?.writeGranted).toBeFalse();
    });

    it('is false without a handle, with the stamp of the chosen file', async () => {
      win.showOpenFilePicker = undefined;
      const file = new File([new Uint8Array([4, 5])], 'x.pdf', { lastModified: 9 });
      spyOn(
        service as unknown as { pickWithInput(): Promise<File> },
        'pickWithInput',
      ).and.resolveTo(file);

      const picked = await service.pickPdf();

      expect(picked?.handle).toBeNull();
      expect(picked?.writeGranted).toBeFalse();
      expect(picked?.stamp).toEqual({ size: 2, lastModified: 9 });
    });
  });

  describe('hasWritePermission', () => {
    it('is true when queryPermission is missing', async () => {
      expect(await service.hasWritePermission(fakeHandle())).toBeTrue();
    });

    it('asks for readwrite and is true only for granted', async () => {
      const query = jasmine.createSpy().and.resolveTo('prompt');

      expect(await service.hasWritePermission(fakeHandle({ queryPermission: query }))).toBeFalse();
      expect(query).toHaveBeenCalledWith({ mode: 'readwrite' });
    });
  });

  describe('requestWritePermission', () => {
    it('is true when requestPermission is missing', async () => {
      const handle = fakeHandle({ queryPermission: () => Promise.resolve('prompt') });

      expect(await service.requestWritePermission(handle)).toBeTrue();
    });

    it('requests readwrite and returns whether it was granted', async () => {
      const request = jasmine.createSpy().and.resolveTo('denied');
      const handle = fakeHandle({
        queryPermission: () => Promise.resolve('prompt'),
        requestPermission: request,
      });

      expect(await service.requestWritePermission(handle)).toBeFalse();
      expect(request).toHaveBeenCalledWith({ mode: 'readwrite' });
    });
  });

  describe('refresh', () => {
    it('reads the file behind the handle again, keeping the handle and permission', async () => {
      let content = new Uint8Array([1]);
      const handle = {
        getFile: () => Promise.resolve(new File([content], 'b.pdf', { lastModified: 5 })),
      } as unknown as FileSystemFileHandle;
      pickerReturning(handle);
      const picked = await service.pickPdf();
      content = new Uint8Array([2, 3]);

      const fresh = await service.refresh(picked!);

      expect(Array.from(fresh.bytes)).toEqual([2, 3]);
      expect(fresh.stamp.size).toBe(2);
      expect(fresh.handle).toBe(handle);
      expect(fresh.writeGranted).toBe(picked!.writeGranted);
    });

    it('returns a file without a handle as is', async () => {
      const picked = {
        name: 'x.pdf',
        bytes: new Uint8Array([1]),
        handle: null,
        stamp: { size: 1, lastModified: 1 },
        writeGranted: false,
      };

      expect(await service.refresh(picked)).toBe(picked);
    });

    it('rejects when the file cannot be read', async () => {
      const handle = {
        getFile: () => Promise.reject(new Error('gone')),
      } as unknown as FileSystemFileHandle;
      const picked = {
        name: 'x.pdf',
        bytes: new Uint8Array(),
        handle,
        stamp: { size: 0, lastModified: 0 },
        writeGranted: true,
      };

      await expectAsync(service.refresh(picked)).toBeRejectedWithError('gone');
    });
  });

  describe('stampOf', () => {
    it('returns the current size and modification time', async () => {
      expect(await service.stampOf(fakeHandle())).toEqual({ size: 3, lastModified: 777 });
    });

    it('propagates a getFile rejection', async () => {
      const handle = {
        getFile: () => Promise.reject(new Error('gone')),
      } as unknown as FileSystemFileHandle;

      await expectAsync(service.stampOf(handle)).toBeRejectedWithError('gone');
    });
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
