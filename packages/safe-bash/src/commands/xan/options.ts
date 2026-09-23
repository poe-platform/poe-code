export const defaultLimits = Object.freeze({
  maxArgs: Infinity, maxArgumentBytes: Infinity, maxInputFiles: Infinity,
  maxInputBytes: Infinity, maxChunks: Infinity, maxChunkBytes: Infinity,
  maxRecordBytes: Infinity, maxCellBytes: Infinity, maxColumns: Infinity,
  maxRecords: Infinity, maxSelectorBytes: Infinity, maxSelectorNodes: Infinity,
  maxSelectorDepth: Infinity, maxSelectedColumns: Infinity, maxLastRows: Infinity,
  maxWork: Infinity, maxOutputBytes: Infinity, maxRetainedBytes: Infinity,
});
export type XanLimits = { readonly [Key in keyof typeof defaultLimits]: number };
export interface XanCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<XanLimits>;
}
export const hardLimits: XanLimits = defaultLimits;
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
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid xan limit: ${name}`);
    limits[name] = value;
  }
  return { limits: Object.freeze(limits), replace: options.replace ?? false };
}
