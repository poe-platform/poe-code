export interface ResourceLimits {
  readonly maxInputBytes: number;
  readonly maxDecodedBytes: number;
  readonly maxRetainedBytes: number;
  readonly maxOutputBytes: number;
  readonly maxWork: number;
  readonly maxArguments?: number;
  readonly maxFiles?: number;
  readonly maxArgfileDepth?: number;
  readonly maxStagingAttempts?: number;
}
export const exiftoolLimits: Required<ResourceLimits> = Object.freeze({
  maxInputBytes: Infinity, maxDecodedBytes: Infinity,
  maxRetainedBytes: Infinity, maxOutputBytes: Infinity, maxWork: Infinity,
  maxArguments: Infinity, maxFiles: Infinity, maxArgfileDepth: Infinity, maxStagingAttempts: Infinity,
});
export type EngineOptions = Partial<ResourceLimits> & { readonly signal: AbortSignal };

export class ResourceLimitError extends RangeError {}

/** Cumulative admission for a single operation. No recursive parser is admitted. */
export class Resources {
  readonly limits: Required<ResourceLimits>;
  readonly signal: AbortSignal;
  readonly usage = { input: 0, decoded: 0, retained: 0, output: 0, work: 0 };
  constructor(options: EngineOptions) {
    this.signal = options.signal;
    this.signal.throwIfAborted();
    this.limits = Object.freeze({ ...exiftoolLimits, ...options });
    for (const key of Object.keys(exiftoolLimits) as (keyof ResourceLimits)[]) {
      if (this.limits[key] !== Infinity && (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 0)) throw new RangeError("Invalid resource limit: " + key);
    }
  }
  admit(kind: keyof Resources["usage"], amount: number): void {
    this.signal.throwIfAborted();
    const limits = { input: "maxInputBytes", decoded: "maxDecodedBytes", retained: "maxRetainedBytes", output: "maxOutputBytes", work: "maxWork" } as const;
    const total = this.usage[kind] + amount;
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(total) || total > this.limits[limits[kind]]) throw new ResourceLimitError("ExifTool " + kind + " budget exceeded");
    this.usage[kind] = total;
  }
}
