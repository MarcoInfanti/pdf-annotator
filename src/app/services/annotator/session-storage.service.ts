import { Injectable } from '@angular/core';
import type {
  Annotation,
  DocumentIdentity,
  FileStamp,
  ReadingPosition,
  RecoveryCopy,
} from '../../models/annotator.model';
import {
  parseAnnotationFile,
  serializeAnnotations,
} from '../../annotator/annotation-file/annotation-file';
import { parseReadingPosition } from '../../annotator/reading-position/reading-position';

const POSITION_PREFIX = 'pdf-annotations.position.';
const RECOVERY_PREFIX = 'pdf-annotations.recovery.';

/**
 * Per-document data kept in localStorage between sessions: where the user stopped reading and
 * unsaved annotations that could not reach the disk. Stateless; every access is guarded, because
 * storage can be blocked or full, and a failure only means the data is not remembered.
 */
@Injectable({ providedIn: 'root' })
export class SessionStorageService {
  /** The stored reading position of the document, or null when absent or corrupt. */
  readPosition(identity: DocumentIdentity): ReadingPosition | null {
    try {
      const raw = localStorage.getItem(POSITION_PREFIX + keyOf(identity));
      return raw === null ? null : parseReadingPosition(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Remembers the reading position of the document. */
  writePosition(identity: DocumentIdentity, position: ReadingPosition): void {
    this.write(POSITION_PREFIX + keyOf(identity), JSON.stringify(position));
  }

  /** The stored recovery copy of the document, or null when absent or corrupt. */
  readRecovery(identity: DocumentIdentity): RecoveryCopy | null {
    try {
      const raw = localStorage.getItem(RECOVERY_PREFIX + keyOf(identity));
      return raw === null ? null : parseRecovery(raw);
    } catch {
      return null;
    }
  }

  /** Keeps the unsaved annotations, with the stamp of the file they were made against. */
  writeRecovery(identity: DocumentIdentity, annotations: Annotation[], baseline: FileStamp): void {
    const value = JSON.stringify({ baseline, annotations: serializeAnnotations(annotations) });
    this.write(RECOVERY_PREFIX + keyOf(identity), value);
  }

  /** Forgets the recovery copy of the document. */
  clearRecovery(identity: DocumentIdentity): void {
    try {
      localStorage.removeItem(RECOVERY_PREFIX + keyOf(identity));
    } catch {
      // Storage unavailable: there is nothing to clear.
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked or full: the data just isn't remembered.
    }
  }
}

function keyOf(identity: DocumentIdentity): string {
  return `${identity.name}|${identity.pageCount}`;
}

/** Parses a stored recovery copy; throws on anything malformed, which the caller turns into null. */
function parseRecovery(raw: string): RecoveryCopy {
  const { baseline, annotations } = JSON.parse(raw) as Record<string, unknown>;
  if (typeof annotations !== 'string' || !isStamp(baseline)) throw new Error('Bad recovery copy');
  return {
    baseline: { size: baseline.size, lastModified: baseline.lastModified },
    annotations: parseAnnotationFile(annotations),
  };
}

function isStamp(value: unknown): value is FileStamp {
  if (typeof value !== 'object' || value === null) return false;
  const { size, lastModified } = value as Record<string, unknown>;
  return Number.isFinite(size) && Number.isFinite(lastModified);
}
