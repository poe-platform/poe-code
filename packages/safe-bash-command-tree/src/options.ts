export interface TreeLimits {
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

export interface TreeCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<TreeLimits>;
}

export function settings(options: TreeCommandsOptions): TreeLimits {
  const limits: TreeLimits = {
    maxArguments: Infinity, maxArgumentBytes: Infinity, maxEntries: Infinity,
    maxDirectoryEntries: Infinity, maxDepth: Infinity, maxPathBytes: Infinity,
    maxMetadataBytes: Infinity, maxOutputBytes: Infinity,
    maxSteps: Infinity, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) throw new RangeError(`Invalid tree limit: ${name}`);
  }
  return Object.freeze(limits);
}
