export interface WhichLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxPathEnvBytes: number;
  readonly maxPathComponents: number;
  readonly maxPathBytes: number;
  readonly maxProbes: number;
  readonly maxOutputBytes: number;
}

export interface WhichCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<WhichLimits>;
}

const DEFAULT_LIMITS: WhichLimits = Object.freeze({
  maxArguments: Infinity,
  maxArgumentBytes: Infinity,
  maxPathEnvBytes: Infinity,
  maxPathComponents: Infinity,
  maxPathBytes: Infinity,
  maxProbes: Infinity,
  maxOutputBytes: Infinity,
});

export function settings(options: WhichCommandsOptions): WhichLimits {
  for (const key of Reflect.ownKeys(options.limits ?? {})) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new RangeError(`Unknown which limit: ${String(key)}`);
  }
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1
      || (key === "maxPathBytes" && value > Number.MAX_SAFE_INTEGER - 256))) {
      throw new RangeError(`Invalid which limit: ${key}`);
    }
  }
  return Object.freeze(limits);
}
