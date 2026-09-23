/** Execution budget failures retire a browser; snapshot reads can be recoverable. */
export class PlaywrightResourceLimitError extends Error {
  override readonly name = 'PlaywrightResourceLimitError';
}

/** A completed read exceeded its output budget; the browser remains usable. */
export class PlaywrightSnapshotLimitError extends PlaywrightResourceLimitError {}

export function isPlaywrightResourceLimitError(error: unknown): boolean {
  return error instanceof PlaywrightResourceLimitError || error instanceof AggregateError && error.errors.some(isPlaywrightResourceLimitError);
}

/** A completed snapshot read refused by its explicit byte/ref budget. */
export class PlaywrightSnapshotLimitError extends PlaywrightResourceLimitError {}
