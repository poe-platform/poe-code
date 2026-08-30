export const defaultLimits = Object.freeze({
  maxArgs: 128, maxArgumentBytes: 65536, maxInputFiles: 16,
  maxInputBytes: 268435456, maxChunks: 262144, maxChunkBytes: 8388608,
  maxRecordBytes: 8388608, maxCellBytes: 4194304, maxColumns: 16384,
  maxRecords: 1000000, maxSelectorBytes: 16384, maxSelectorNodes: 4096,
  maxSelectorDepth: 2, maxSelectedColumns: 16384, maxLastRows: 4096,
  maxWork: 1000000000, maxOutputBytes: 268435456, maxRetainedBytes: 33554432,
});
export type XanLimits = { readonly [Key in keyof typeof defaultLimits]: number };
export interface XanCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<XanLimits>;
}
export const hardLimits: XanLimits = Object.freeze({
  maxArgs: 4096, maxArgumentBytes: 1048576, maxInputFiles: 256,
  maxInputBytes: 4294967296, maxChunks: 4194304, maxChunkBytes: 67108864,
  maxRecordBytes: 67108864, maxCellBytes: 33554432, maxColumns: 65536,
  maxRecords: 16000000, maxSelectorBytes: 262144, maxSelectorNodes: 65536,
  maxSelectorDepth: 2, maxSelectedColumns: 65536, maxLastRows: 65536,
  maxWork: 16000000000, maxOutputBytes: 4294967296, maxRetainedBytes: 268435456,
});
export function validateOptions(options: XanCommandsOptions = {}): { limits: XanLimits; replace: boolean } {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Invalid xan options");
  for (const key of Reflect.ownKeys(options)) if (key !== "limits" && key !== "replace") throw new TypeError(`Unknown xan option: ${String(key)}`);
  if (Object.hasOwn(options, "replace") && typeof options.replace !== "boolean") throw new TypeError("Invalid xan replace");
  const supplied = options.limits;
  if (supplied !== undefined && (!supplied || typeof supplied !== "object" || Array.isArray(supplied))) throw new TypeError("Invalid xan limits");
  const limits = { ...defaultLimits } as { -readonly [Key in keyof XanLimits]: number };
  for (const key of Reflect.ownKeys(supplied ?? {})) {
    if (typeof key !== "string" || !Object.hasOwn(defaultLimits, key)) throw new TypeError(`Unknown xan limit: ${String(key)}`);
    const name = key as keyof XanLimits;
    const value = supplied![name];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > hardLimits[name]) throw new RangeError(`Invalid xan limit: ${name}`);
    limits[name] = value;
  }
  return { limits: Object.freeze(limits), replace: options.replace ?? false };
}
