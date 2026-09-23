export interface ShufCommandsOptions {
  readonly replace?: boolean;
  readonly maxInputBytes?: number;
  readonly maxSampleSize?: number;
}

export function settings(options: ShufCommandsOptions) {
  const limits = { maxInputBytes: options.maxInputBytes ?? Infinity, maxSampleSize: options.maxSampleSize ?? Infinity };
  for (const [name, value] of Object.entries(options)) {
    if (name === "replace") continue;
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid shuf ${name}`);
  }
  return Object.freeze(limits);
}
