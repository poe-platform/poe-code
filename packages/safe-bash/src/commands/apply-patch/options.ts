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
  maxPatchBytes: Infinity,
  maxFiles: Infinity,
  maxHunks: Infinity,
  maxPathBytes: Infinity,
  maxPathComponents: Infinity,
  maxFileBytes: Infinity,
  maxReadBytes: Infinity,
  maxStagedBytes: Infinity,
  maxLines: Infinity,
  maxInputChunks: Infinity,
  maxFsCalls: Infinity,
  maxWork: Infinity,
  maxOutputBytes: Infinity,
  maxDiagnosticBytes: Infinity,
});

export function settings(options: ApplyPatchCommandsOptions): ApplyPatchLimits {
  const limits = { ...maxima };
  if (options.limits !== undefined) {
    if (!options.limits || typeof options.limits !== "object") throw new TypeError("apply_patch limits must be an object");
    for (const [name, value] of Object.entries(options.limits)) {
      if (!Object.hasOwn(maxima, name)) throw new TypeError(`Unknown apply_patch limit: ${name}`);
      const key = name as keyof ApplyPatchLimits;
      if (!Number.isSafeInteger(value) || value < (key === "maxDiagnosticBytes" ? 32 : 1)) {
        throw new RangeError(`apply_patch ${key} must be a positive safe integer`);
      }
      limits[key] = value;
    }
  }
  return Object.freeze(limits);
}
