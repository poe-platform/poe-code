/** Serialization policy, separate from extracted tag values and raw bytes. */
export interface ScalarOptions {
  readonly quoteScalars?: boolean;
  readonly maxDecodedBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxRetainedBytes?: number;
  readonly maxWork?: number;
  readonly signal?: AbortSignal;
}
const jsonEscapes: Readonly<Record<number, string>> = Object.freeze({ 9: "\\t", 10: "\\n", 13: "\\r", 34: '\\"', 92: "\\\\" });

function admit(value: string, options: ScalarOptions): void {
  options.signal?.throwIfAborted();
  const limits = [options.maxDecodedBytes ?? 2_097_152, options.maxOutputBytes ?? 6_291_458, options.maxWork ?? 4_194_304, options.maxRetainedBytes ?? 14_680_068];
  if (limits.some(limit => !Number.isSafeInteger(limit) || limit < 0)) throw new RangeError("Invalid scalar limit");
  if (value.length * 2 > limits[0]!) throw new RangeError("Scalar decoded bytes exceeded");
  if (value.length * 4 > limits[2]!) throw new RangeError("Scalar work exceeded");
  if (4 + value.length * 14 > limits[3]!) throw new RangeError("Scalar retained bytes exceeded");
}

function numericSpelling(value: string): boolean {
  // The pinned CLI end anchor also matches immediately before a final LF.
  const length = value.endsWith("\n") ? value.length - 1 : value.length;
  let index = value[0] === "-" ? 1 : 0;
  const start = index;
  const digit = (): boolean => index < length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57;
  while (digit()) index++;
  const integers = index - start;
  if (!integers || integers > 15 || (integers > 1 && value[start] === "0")) return false;
  if (value[index] === ".") {
    const fraction = ++index;
    while (digit()) index++;
    if (index === fraction || index - fraction > 16) return false;
  }
  if (value[index] === "e" || value[index] === "E") {
    index++;
    if (value[index] === "+" || value[index] === "-") index++;
    const exponent = index;
    while (digit()) index++;
    if (index === exponent || index - exponent > 3) return false;
  }
  return index === length;
}

/** ExifTool 13.59 scalar JSON policy. Never converts lexical numbers to Number. */
export function encodeJsonScalar(value: string, options: ScalarOptions = {}): string {
  admit(value, options);
  const limit = options.maxOutputBytes ?? 6_291_458;
  if (!options.quoteScalars) {
    const lower = value.toLowerCase();
    const boolean = lower.endsWith("\n") ? lower.slice(0, -1) : lower;
    const token = boolean === "true" || boolean === "false" ? lower : numericSpelling(value) ? value : undefined;
    if (token !== undefined) {
      if (token.length > limit) throw new RangeError("Scalar output bytes exceeded");
      return token;
    }
  }
  // Reserve the maximum encoded extent before building strings. This deliberately
  // conservative bound also accounts for UTF-8 and surrogate repair.
  if (2 + value.length * 6 > limit) throw new RangeError("Scalar output bytes exceeded");
  let output = '"';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) continue;
    const escape = jsonEscapes[code];
    if (escape) output += escape;
    else if (code < 32 || code === 127) output += "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) output += value[index]! + value[++index]!;
      else output += "\uFFFD";
    } else if (code >= 0xdc00 && code <= 0xdfff) output += "\uFFFD";
    else output += value[index];
  }
  options.signal?.throwIfAborted();
  return output + '"';
}

/** Plain text display only; do not use to reconstruct stored metadata. */
export function printable(value: string, options: ScalarOptions = {}): string {
  admit(value, options);
  if (value.length * 3 > (options.maxOutputBytes ?? 6_291_458)) throw new RangeError("Scalar output bytes exceeded");
  let end = value.length;
  // NUL disappears; other controls become dots and therefore survive trimming.
  while (end && (value.charCodeAt(end - 1) === 0 || value[end - 1] === " ")) end--;
  let output = "";
  for (let index = 0; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code) output += code < 32 || code === 127 ? "." : value[index];
  }
  return output;
}
