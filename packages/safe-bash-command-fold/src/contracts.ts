export type FoldMode = 'columns' | 'characters' | 'bytes';
export interface FoldOptions { readonly width: number; readonly mode: FoldMode; readonly spaces: boolean; readonly files: readonly string[] }
export interface FoldLimits {
  readonly inputBytes: number;
  /** Encoded bytes decoded once, including invalid bytes and LF; defaults to inputBytes. */
  readonly decodedBytes?: number;
  readonly outputBytes: number;
  readonly retainedBytes: number;
  readonly work: number;
  readonly argumentBytes: number;
}
export type FoldErrorCode = 'OPTION' | 'WIDTH' | 'INPUT' | 'LIMIT' | 'LOCALE' | 'ARITHMETIC' | 'CANCELLED' | 'CLOSED';
export class FoldError extends Error {
  constructor(readonly code: FoldErrorCode, message: string) { super(message); this.name = 'FoldError'; }
}
export function validateLimits(limits: FoldLimits): void {
  for (const value of [limits.inputBytes, limits.decodedBytes ?? limits.inputBytes, limits.outputBytes, limits.retainedBytes, limits.work, limits.argumentBytes]) if (!Number.isSafeInteger(value) || value < 0) throw new FoldError('LIMIT', 'Limits must be nonnegative safe integers');
  if (limits.retainedBytes < 8196) throw new FoldError('LIMIT', 'The release buffer contract requires 8192 line bytes plus 4 decoder bytes');
}
