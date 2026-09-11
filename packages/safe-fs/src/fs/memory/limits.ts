import { readConfigRecord } from "../../config.js";

export interface MemoryFileSystemLimits {
  readonly maxBytes?: number;
  readonly maxFileBytes: number;
  readonly maxRetainedBytes: number;
  readonly maxMetadataUnits: number;
}

export type MemoryFileSystemOptions = Partial<MemoryFileSystemLimits>;

export const defaultMemoryFileSystemLimits: Readonly<MemoryFileSystemLimits> = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxRetainedBytes: 64 * 1024 * 1024,
  maxMetadataUnits: 10_000,
});

export function normalizeMemoryFileSystemLimits(options: unknown): Readonly<MemoryFileSystemLimits> {
  const keys = ["maxFileBytes", "maxRetainedBytes", "maxMetadataUnits"] as const;
  const record = readConfigRecord(options, "memory option", [...keys, "maxBytes"]);
  const limits: { -readonly [Key in keyof MemoryFileSystemLimits]: MemoryFileSystemLimits[Key] } = { ...defaultMemoryFileSystemLimits };
  if (Object.hasOwn(record, "maxBytes") && record.maxBytes !== undefined) {
    if (typeof record.maxBytes !== "number" || !Number.isSafeInteger(record.maxBytes) || record.maxBytes < 0) {
      throw new RangeError("maxBytes must be a nonnegative safe integer");
    }
    limits.maxBytes = record.maxBytes;
  }
  for (const key of keys) {
    const value = Object.hasOwn(record, key) ? record[key] : limits[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "maxMetadataUnits" ? 1 : 0)) {
      throw new RangeError(`${key} must be a ${key === "maxMetadataUnits" ? "positive" : "nonnegative"} safe integer`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}
