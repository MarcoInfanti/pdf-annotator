import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'pdf-annotations.autosave';

/** Whether the user wants changes saved automatically; on unless they turned it off. */
@Injectable({ providedIn: 'root' })
export class AutosavePreferenceService {
  private readonly _enabled = signal(readStoredPreference());
  /** True when autosave is wanted (the default). */
  readonly enabled = this._enabled.asReadonly();

  /** Applies the preference and remembers it; storage failures are ignored. */
  set(enabled: boolean): void {
    this._enabled.set(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Storage unavailable (private mode): the choice just isn't remembered.
    }
  }
}

/** Stored preference; only an explicit 'false' turns autosave off. */
function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}
