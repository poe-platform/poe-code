/** Budget failures retire a browser; ordinary command errors may leave it usable. */
export class PlaywrightResourceLimitError extends Error {
  override readonly name = 'PlaywrightResourceLimitError';
}

export function isPlaywrightResourceLimitError(error: unknown): boolean {
  return error instanceof PlaywrightResourceLimitError || error instanceof AggregateError && error.errors.some(isPlaywrightResourceLimitError);
}
