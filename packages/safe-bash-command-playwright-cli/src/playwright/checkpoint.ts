/** Trusted storage readers may emit this only after confirmed owned-target
 * destruction with healthy control. Never use it for cancellation, uncertain
 * acquisition, ownership validation, resource limits, or failed cleanup. No profile was saved.
 */
export class PlaywrightStorageReadError extends Error {
  override readonly name = 'PlaywrightStorageReadError';
  constructor(cause: unknown) {
    super('Browser storage read failed after confirmed target cleanup', { cause });
  }
}

export type PlaywrightCheckpointOutcome =
  | { readonly status: 'committed' }
  | { readonly status: 'storage-read-failed'; readonly error: PlaywrightStorageReadError };

/** Partial success: replaying the action is unsafe; only persistence failed. */
export class PlaywrightCheckpointError extends Error {
  override readonly name = 'PlaywrightCheckpointError';
  readonly actionCompleted = true;
  readonly profileCommitted = false;
  constructor(cause: PlaywrightStorageReadError) {
    super('Action completed; persistence failed. The live session remains usable. The saved profile is unchanged; do not replay the action.', { cause });
  }
}
