import { Injectable } from '@angular/core';
import type {
  FilePickerFunction,
  FilePickerWindow,
  FileStamp,
  PermissionedFileHandle,
  PickedFile,
  WritePermissionDescriptor,
} from '../../models/annotator.model';

/** File picker filter for PDFs. */
const PDF_TYPE = { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } };

/** Permission descriptor for writing. */
const WRITE_MODE: WritePermissionDescriptor = { mode: 'readwrite' };

/** Opens files and writes them back, overwriting the original when the browser allows it. */
@Injectable({ providedIn: 'root' })
export class FileAccessService {
  /** True when the browser can hand out writable file handles (File System Access API). */
  readonly canOverwrite = typeof (window as FilePickerWindow).showOpenFilePicker === 'function';

  /** Asks for a PDF; resolves `null` when the user cancels the picker. */
  async pickPdf(): Promise<PickedFile | null> {
    const picker = (window as FilePickerWindow).showOpenFilePicker;
    if (!picker) {
      const file = await this.pickWithInput('.pdf,application/pdf');
      return file && (await toPicked(file, null, false));
    }
    try {
      return await this.pickWithHandle(picker);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  }

  /**
   * The picked file as it is on disk now. Without a handle the file cannot have changed under us,
   * so it is returned as is.
   */
  async refresh(picked: PickedFile): Promise<PickedFile> {
    if (!picked.handle) return picked;
    return toPicked(await picked.handle.getFile(), picked.handle, picked.writeGranted);
  }

  /** Whether the handle can be written to right now; true where the browser has no permission API. */
  async hasWritePermission(handle: PermissionedFileHandle): Promise<boolean> {
    if (!handle.queryPermission) return true;
    return (await handle.queryPermission(WRITE_MODE)) === 'granted';
  }

  /**
   * Asks for write access if it is not granted yet. The prompt needs a user gesture, so call it
   * from a click or key handler, never from a timer.
   */
  async requestWritePermission(handle: PermissionedFileHandle): Promise<boolean> {
    if (await this.hasWritePermission(handle)) return true;
    if (!handle.requestPermission) return true;
    return (await handle.requestPermission(WRITE_MODE)) === 'granted';
  }

  /** Size and modification time of the file on disk now; rejects when the file cannot be read. */
  async stampOf(handle: FileSystemFileHandle): Promise<FileStamp> {
    return stampOfFile(await handle.getFile());
  }

  /** Asks for a text file with an input element; resolves `null` when cancelled. */
  async pickText(accept: string): Promise<string | null> {
    const file = await this.pickWithInput(accept);
    return file ? file.text() : null;
  }

  /** Writes the bytes over the file the handle points to. */
  async overwrite(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
  }

  /** Triggers a browser download; the object URL is revoked after one second. */
  download(content: Uint8Array | string, fileName: string, type: string): void {
    const blob = new Blob([content as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Picker that opens the file read-only, so a document that is only read never triggers a
   * permission prompt. Write access is only queried; it is requested on the first change.
   */
  private async pickWithHandle(picker: FilePickerFunction): Promise<PickedFile> {
    const [handle] = await picker.call(window, { types: [PDF_TYPE] });
    const file = await handle.getFile();
    const writeGranted = await this.hasWritePermission(handle).catch(() => false);
    return toPicked(file, handle, writeGranted);
  }

  private pickWithInput(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
}

/** Reads a file fully into memory. */
async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Size and modification time of a file. */
function stampOfFile(file: File): FileStamp {
  return { size: file.size, lastModified: file.lastModified };
}

async function toPicked(
  file: File,
  handle: FileSystemFileHandle | null,
  writeGranted: boolean,
): Promise<PickedFile> {
  return {
    name: file.name,
    bytes: await readBytes(file),
    handle,
    stamp: stampOfFile(file),
    writeGranted,
  };
}
