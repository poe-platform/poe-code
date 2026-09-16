export interface ShufCommandsOptions {
  readonly replace?: boolean;
  readonly maxInputBytes?: number;
  readonly maxSampleSize?: number;
}

export function settings(options: ShufCommandsOptions) {
  const limits = { maxInputBytes: options.maxInputBytes ?? 64 * 1024 * 1024, maxSampleSize: options.maxSampleSize ?? 1_000_000 };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid shuf ${name}`);
  }
  return Object.freeze(limits);
}
