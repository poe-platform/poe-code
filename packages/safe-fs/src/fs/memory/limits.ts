import { readConfigRecord } from "../../config.js";

export interface MemoryFileSystemLimits {
  readonly maxBytes?: number;
  readonly maxFileBytes: number;
  readonly maxRetainedBytes: number;
  readonly maxMetadataUnits: number;
}

export type MemoryFileSystemOptions = {
  readonly [Key in keyof MemoryFileSystemLimits]?: MemoryFileSystemLimits[Key] | undefined;
};

export const defaultMemoryFileSystemLimits: Readonly<MemoryFileSystemLimits> = Object.freeze({
  maxFileBytes: Infinity,
  maxRetainedBytes: Infinity,
  maxMetadataUnits: Infinity,
});

export function normalizeMemoryFileSystemLimits(options: unknown): Readonly<MemoryFileSystemLimits> {
  const keys = ["maxFileBytes", "maxRetainedBytes", "maxMetadataUnits"] as const;
  const record = readConfigRecord(options, "memory option", [...keys, "maxBytes"]);
  const limits: { -readonly [Key in keyof MemoryFileSystemLimits]: MemoryFileSystemLimits[Key] } = { ...defaultMemoryFileSystemLimits };
  for (const key of [...keys, "maxBytes"] as const) {
    const value = record[key];
    if (value === undefined || value === Infinity) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "maxMetadataUnits" ? 1 : 0)) {
      throw new RangeError(`${key} must be a ${key === "maxMetadataUnits" ? "positive" : "nonnegative"} safe integer or Infinity`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}
