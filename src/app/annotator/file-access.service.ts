import { Injectable } from '@angular/core';

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Present when the browser supports the File System Access API (Chrome, Edge). */
  handle: FileSystemFileHandle | null;
}

interface FilePickerOptions {
  types: { description: string; accept: Record<string, string[]> }[];
}

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
};

const PDF_TYPE = { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } };

/** Opens files and writes them back, overwriting the original when the browser allows it. */
@Injectable({ providedIn: 'root' })
export class FileAccessService {
  readonly canOverwrite = typeof (window as FilePickerWindow).showOpenFilePicker === 'function';

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

  async pickText(accept: string): Promise<string | null> {
    const file = await this.pickWithInput(accept);
    return file ? file.text() : null;
  }

  async overwrite(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
  }

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
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
}

async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
