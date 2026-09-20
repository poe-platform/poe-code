/** No decoding or terminal-width calculation: all non-ASCII bytes are opaque. */
export type FmtProfile = 'gnu-coreutils-9.10-C-bytes' | 'gnu-coreutils-8.30-C-bytes';
export const fmtBaseline = Object.freeze({
  release: 'GNU coreutils 9.10',
  archiveSha256: '16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25',
  developmentSource: 'b25722854370b8206d7f53f8934c36710cdd9974',
  profile: 'gnu-coreutils-9.10-C-bytes' as const,
});
export interface FmtLimits {
  readonly inputBytes: number;
  readonly outputBytes: number;
  /** Live engine byte buffers, including prefix; word records are separately bounded to 999. */
  readonly retainedBytes: number;
  readonly work: number;
  readonly argumentBytes: number;
}
export const defaultFmtLimits: FmtLimits = Object.freeze({
  inputBytes: 32 * 1024 * 1024, outputBytes: 32 * 1024 * 1024,
  retainedBytes: 80 * 1024, work: 128 * 1024 * 1024, argumentBytes: 65536,
});
export interface FmtOptions {
  readonly profile: FmtProfile;
  readonly width: number;
  readonly goal: number;
  readonly crown: boolean;
  readonly tagged: boolean;
  readonly split: boolean;
  readonly uniform: boolean;
  readonly prefix: Uint8Array;
  readonly leading: number;
  readonly fullPrefix: number;
  readonly files: readonly { readonly name: string; readonly bytes: Uint8Array }[];
  readonly information?: string;
}
export type FmtErrorCode = 'OPTION' | 'WIDTH' | 'INPUT' | 'LIMIT' | 'PROFILE' | 'ARITHMETIC' | 'CANCELLED' | 'CLOSED';
export class FmtError extends Error {
  constructor(readonly code: FmtErrorCode, message: string, readonly usage = false) { super(message); this.name = 'FmtError'; }
}
export function validateFmtLimits(limits: FmtLimits): void {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 0) throw new FmtError('LIMIT', 'Limits must be nonnegative safe integers');
  for (const key of ['inputBytes', 'outputBytes', 'retainedBytes', 'work', 'argumentBytes'] as const) if (limits[key] === undefined) throw new FmtError('LIMIT', `Missing ${key} limit`);
}
export function validateFmtProfile(profile: FmtProfile): void {
  if (profile !== fmtBaseline.profile && profile !== 'gnu-coreutils-8.30-C-bytes') throw new FmtError('PROFILE', 'Unavailable fmt byte/locale profile');
}
