export interface UnrtfLimits {
  retainedBytes: number;
  images: number;
  imageBytes: number;
  inputBytes: number;
  binaryBytes: number;
  tokenBytes: number;
  tokens: number;
  depth: number;
  decodedBytes: number;
  outputBytes: number;
  work: number;
}
export const defaultUnrtfLimits: UnrtfLimits = Object.freeze({inputBytes: Infinity, retainedBytes: Infinity, binaryBytes: Infinity, images: Infinity, imageBytes: Infinity, tokenBytes: Infinity, tokens: Infinity, depth: Infinity, decodedBytes: Infinity, outputBytes: Infinity, work: Infinity});
export interface UnrtfOptions { limits?: Partial<UnrtfLimits>; signal: AbortSignal; profile?: 'standards-strict' | 'gnu-0.21.10' | 'native-legacy' | 'recovery' }
export const unrtfBaseline = Object.freeze({
  version: '0.21.10', archiveSha256: 'b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae',
  profile: 'standards-strict', nativePersonalityCompatible: false,
} as const);
export type UnrtfErrorCode = 'E_PARSE' | 'E_LIMIT' | 'E_CANCELLED' | 'E_CODEC' | 'E_ENCODING' | 'E_PROFILE';
export class UnrtfError extends Error {
  readonly status = 1;
  constructor(readonly code: UnrtfErrorCode, message: string, readonly offset: number, readonly resource?: keyof UnrtfLimits) {
    super(message); this.name = 'UnrtfError';
  }
}
export type RtfToken =
  | { kind: 'open' | 'close'; offset: number }
  | { kind: 'byte'; byte: number; escaped: boolean; offset: number }
  | { kind: 'control'; name: string; parameter: number | undefined; offset: number }
  | { kind: 'symbol'; name: string; offset: number }
  | { kind: 'binary'; length: number; offset: number };
export class Budget {
  private readonly counts: Partial<Record<keyof UnrtfLimits, number>> = {};
  readonly options: UnrtfOptions & { limits: UnrtfLimits };
  constructor(options: UnrtfOptions) {
    if (options.profile !== undefined && options.profile !== 'standards-strict' && options.profile !== 'gnu-0.21.10')
      throw new UnrtfError('E_PROFILE', 'Only standards-strict extraction is admitted; native-legacy and recovery are not implemented', 0);
    this.options = {...options, limits:{...defaultUnrtfLimits,...options.limits}};
    for (const name of ['retainedBytes','images','imageBytes','inputBytes','binaryBytes','tokenBytes','tokens','depth','decodedBytes','outputBytes','work'] as const) {
      if (this.options.limits[name] !== Infinity && (!Number.isSafeInteger(this.options.limits[name]) || this.options.limits[name] < 0))
        throw new UnrtfError('E_LIMIT', 'Limits must be nonnegative safe integers', 0, name);
    }
  }
  release(resource: keyof UnrtfLimits, value: number): void {
    this.counts[resource] = (this.counts[resource] ?? 0) - value;
  }
  check(offset: number): void {
    if (this.options.signal.aborted) throw new UnrtfError('E_CANCELLED', 'RTF invocation cancelled', offset);
  }
  bound(resource: keyof UnrtfLimits, value: number, offset: number): void {
    this.check(offset);
    if (value > this.options.limits[resource]) throw new UnrtfError('E_LIMIT', `RTF ${resource} limit exceeded`, offset, resource);
  }
  charge(resource: keyof UnrtfLimits, value: number, offset: number): void {
    const count = this.counts[resource] ?? 0;
    if (value > this.options.limits[resource] - count) throw new UnrtfError('E_LIMIT', `RTF ${resource} limit exceeded`, offset, resource);
    this.bound(resource, count + value, offset); this.counts[resource] = count + value;
  }
}
