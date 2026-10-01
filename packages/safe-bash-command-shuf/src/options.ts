export interface ShufCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<ShufLimits>;
  readonly maxInputBytes?: number;
  readonly maxSampleSize?: number;
}

export function settings(options: ShufCommandsOptions = {}) {
  const limits = { maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? Infinity, maxSampleSize: options.limits?.maxSampleSize ?? options.maxSampleSize ?? Infinity };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid shuf ${name}`);
  }
  return Object.freeze(limits);
}

export interface ShufLimits {
  readonly maxInputBytes: number;
  readonly maxSampleSize: number;
}
export type ShufOptions = ShufCommandsOptions;
