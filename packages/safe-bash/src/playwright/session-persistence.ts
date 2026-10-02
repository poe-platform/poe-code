import type { PlaywrightLease, PlaywrightPage, PlaywrightContextOptions } from './adapter.js';
import type { PlaywrightSessionConfiguration } from './session-configuration.js';
import type { PlaywrightSessionCheckpoint } from './controller.js';
import type { PlaywrightCheckpointOutcome } from './checkpoint.js';
import type { PlaywrightOperationOutcome } from './recovery.js';
import type { PlaywrightSelectionPersistence } from './session-selection.js';

export interface PlaywrightSessionPersistence {
  /** Idle expiry releases Chromium but keeps the logical session resumable. */
  readonly resumeAfterIdle?: boolean;
  /** Owner-scoped selection survives controller eviction without acquiring a browser. */
  readonly selection?: PlaywrightSelectionPersistence;
  /** Authoritative metadata-only read, including receipt eviction and expiry.
   * The controller does not cache receipts when this hook is installed.
   * Must not acquire, navigate or execute browser code. */
  inspectRecovery?(request: { readonly name: string; readonly signal: AbortSignal }): Promise<{
    readonly hasStorage: boolean; readonly operation?: PlaywrightOperationOutcome;
  }>;
  /** Host must durably commit running before returning; never include command payloads.
   * Terminal updates must atomically match an existing receipt's operationId;
   * ignore absent or superseded receipts rather than inserting them.
   * Successful delete-data retires the receipt without a terminal callback.
   */
  recordOperation?(request: { readonly name: string; readonly operation: PlaywrightOperationOutcome }, signal: AbortSignal): Promise<void>;
  /** Enumerates only this owner's resumable profiles; never allocates browsers. */
  list?(signal: AbortSignal): Promise<readonly { readonly name: string; readonly expiresAt?: number }[]>;
  restore(request: { readonly name: string; readonly signal: AbortSignal }): Promise<{
    readonly recovery?: 'saved-storage';
    readonly livePageStateLost?: true;
    readonly lease: PlaywrightLease;
    readonly selectedPage?: PlaywrightPage;
    readonly expiresAt?: number;
    readonly idleTimeoutMs?: number;
    readonly contextOptions?: PlaywrightContextOptions;
    readonly configuration?: PlaywrightSessionConfiguration;
    initialize?(options: { readonly signal: AbortSignal }): Promise<void>;
  } | undefined>;
  /** Commit atomically only after a complete profile read. A failed read must
   * leave the previous committed profile unchanged. Restore returns that last
   * committed profile, never the live state from an unsuccessful checkpoint.
   * Legacy void means committed; a trusted reader may throw StorageReadError.
   */
  checkpoint(session: PlaywrightSessionCheckpoint, signal: AbortSignal): Promise<void | PlaywrightCheckpointOutcome>;
  /** Explicit closure suppresses automatic resume without deleting saved state. */
  close?(name: string | undefined, signal: AbortSignal): Promise<void>;
  /** Delete saved data and its operation receipt before returning successfully. */
  delete(name: string, signal: AbortSignal): Promise<void>;
}
