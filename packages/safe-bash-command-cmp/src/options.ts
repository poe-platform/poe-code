export interface CmpLimits {
  readonly maxChunkBytes: number;
  readonly maxFallbackBytes: number;
}

export interface CmpCommandsOptions {
  readonly replace?: boolean;
  readonly comparisonBlockBytes?: number;
  readonly limits?: Partial<CmpLimits>;
}

const escapes = new Map([[7, "a"], [8, "b"], [9, "t"], [10, "n"], [11, "v"], [12, "f"], [13, "r"]]);

export function quote(value: string): string {
  let result = "'";
  for (const byte of new TextEncoder().encode(value)) {
    const escape = escapes.get(byte);
    result += escape ? `\\${escape}` : byte < 32 || byte >= 127 ? `\\${byte.toString(8).padStart(3, "0")}`
      : byte === 39 || byte === 92 ? `\\${String.fromCharCode(byte)}` : String.fromCharCode(byte);
  }
  return `${result}'`;
}

export function pathQuote(value: string): string {
  if (value && !value.startsWith("~") && !value.startsWith("#") && value !== "{" && value !== "}"
    && Array.from(value).every(character => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./-+,:@%]~#{}".includes(character))) return value;
  const bytes = new TextEncoder().encode(value);
  if (bytes.every(byte => byte >= 32 && byte < 127)) {
    if (!value.includes("'")) return `'${value}'`;
    if (!["$", "`", "\\", '"'].some(character => value.includes(character))) return `"${value}"`;
    return `'${value.replaceAll("'", "'\\''")}'`;
  }
  let result = "'", escaped = false;
  for (const byte of bytes) {
    const special = byte < 32 || byte >= 127;
    if (special !== escaped) {
      result += special ? "'$'" : "''";
      escaped = special;
    }
    result += special ? `\\${escapes.get(byte) ?? byte.toString(8).padStart(3, "0")}`
      : byte === 39 ? "'\\''" : String.fromCharCode(byte);
  }
  return `${result}'`;
}

export function limitsFor(options: CmpCommandsOptions): CmpLimits {
  const limits = { maxChunkBytes: Infinity, maxFallbackBytes: Infinity, ...options.limits };
  for (const [name, value] of Object.entries(options.limits ?? {})) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`cmp ${name} must be a positive safe integer or Infinity`);
  }
  return Object.freeze(limits);
}
