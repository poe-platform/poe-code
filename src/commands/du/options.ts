export interface DuLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxEntries: number;
  readonly maxDirectoryEntries: number;
  readonly maxDepth: number;
  readonly maxPathBytes: number;
  readonly maxMetadataBytes: number;
  readonly maxOutputBytes: number;
  readonly maxSteps: number;
}

export interface DuCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<DuLimits>;
}

export function settings(options: DuCommandsOptions): DuLimits {
  const limits: DuLimits = {
    maxArguments: 4096, maxArgumentBytes: 65536, maxEntries: 100000,
    maxDirectoryEntries: 10000, maxDepth: 256, maxPathBytes: 16384,
    maxMetadataBytes: 8 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024,
    maxSteps: 4 * 1024 * 1024, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid du limit: ${name}`);
  }
  return Object.freeze(limits);
}
