export interface ApplyPatchLimits {
  readonly maxPatchBytes: number;
  readonly maxFiles: number;
  readonly maxHunks: number;
  readonly maxPathBytes: number;
  readonly maxPathComponents: number;
  readonly maxFileBytes: number;
  readonly maxReadBytes: number;
  readonly maxStagedBytes: number;
  readonly maxLines: number;
  readonly maxInputChunks: number;
  readonly maxFsCalls: number;
  readonly maxWork: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
}

export interface ApplyPatchCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<ApplyPatchLimits>;
}

const maxima: ApplyPatchLimits = Object.freeze({
  maxPatchBytes: 4 * 1024 * 1024,
  maxFiles: 256,
  maxHunks: 4096,
  maxPathBytes: 16 * 1024,
  maxPathComponents: 256,
  maxFileBytes: 8 * 1024 * 1024,
  maxReadBytes: 64 * 1024 * 1024,
  maxStagedBytes: 32 * 1024 * 1024,
  maxLines: 262144,
  maxInputChunks: 65536,
  maxFsCalls: 65536,
  maxWork: 128 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxDiagnosticBytes: 16 * 1024,
});

export function settings(options: ApplyPatchCommandsOptions): ApplyPatchLimits {
  const limits = { ...maxima };
  if (options.limits !== undefined) {
    if (!options.limits || typeof options.limits !== "object") throw new TypeError("apply_patch limits must be an object");
    for (const [name, value] of Object.entries(options.limits)) {
      if (!Object.hasOwn(maxima, name)) throw new TypeError(`Unknown apply_patch limit: ${name}`);
      const key = name as keyof ApplyPatchLimits;
      if (!Number.isSafeInteger(value) || value < (key === "maxDiagnosticBytes" ? 32 : 1) || value > maxima[key]) {
        throw new RangeError(`apply_patch ${key} must be a positive safe integer no greater than ${maxima[key]}`);
      }
      limits[key] = value;
    }
  }
  return Object.freeze(limits);
}
