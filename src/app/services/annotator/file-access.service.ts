import { Injectable } from '@angular/core';
import type { FilePickerWindow, PickedFile } from '../../models/annotator.model';

/** File picker filter for PDFs. */
const PDF_TYPE = { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } };

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
      return file && { name: file.name, bytes: await readBytes(file), handle: null };
    }
    try {
      const [handle] = await picker.call(window, { types: [PDF_TYPE] });
      const file = await handle.getFile();
      return { name: file.name, bytes: await readBytes(file), handle };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
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
