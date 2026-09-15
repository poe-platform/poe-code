import { CodePointString } from "./code-point-string.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { renderQuotedPoints } from "./quoted-representation.js";
import { unicodeDecimal } from "./unicode-decimal.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";

/** Parse int's text/bytes grammar, not Python source-token grammar. Input stays
 * in code points; bytes never receive Unicode whitespace/digit normalization.
 * Validate before conversion, then combine small chunks in a balanced tree to
 * avoid repeatedly multiplying an ever-growing integer by a small radix.
 * Base index conversion and settings validation belong to the caller. */
export function parseIntegerText(input: CodePointString | ImmutableBytes, base: number, meter: ExecutionMeter, maxDigits = 4300): bigint {
  meter.checkpoint();
  if (!Number.isInteger(base) || (base !== 0 && (base < 2 || base > 36))) throw new PythonRuntimeError("ValueError", "int() base must be >= 2 and <= 36, or 0");
  if (!Number.isSafeInteger(maxDigits) || maxDigits < 0) throw new RangeError("integer digit limit must be a nonnegative safe integer");
  const text = input instanceof CodePointString;
  meter.checkpoint(0, input.length * 5);
  const points = new Uint32Array(input.length), digits = new Uint8Array(input.length);
  let offset = 0;
  for (let point of input) {
    meter.checkpoint();
    if (text && point > 127) {
      const digit = unicodeDecimal(point, meter);
      if (digit >= 0) point = 48 + digit;
      else if (isUnicodeWhitespace(point)) point = 32;
    }
    points[offset++] = point;
  }
  const invalid = (): never => {
    const quoted = renderQuotedPoints(input, text ? "repr" : "bytes", meter);
    let representation = "";
    for (let index = 0; index < Math.min(200, quoted.length); index++) {
      meter.checkpoint(1, quoted[index] > 0xffff ? 4 : 2);
      representation += String.fromCodePoint(quoted[index]);
    }
    throw new PythonRuntimeError("ValueError", `invalid literal for int() with base ${base}: ${representation}`);
  };
  const whitespace = (point: number): boolean => point === 32 || (point >= 9 && point <= 13);
  let start = 0, end = points.length;
  while (start < end && whitespace(points[start])) { meter.checkpoint(); start++; }
  while (end > start && whitespace(points[end - 1])) { meter.checkpoint(); end--; }
  let negative = false;
  if (points[start] === 43 || points[start] === 45) { negative = points[start] === 45; start++; }
  let radix = base, leadingZero = false;
  if (points[start] === 48) {
    const prefix = points[start + 1] | 32;
    const prefixedBase = prefix === 120 ? 16 : prefix === 111 ? 8 : prefix === 98 ? 2 : 0;
    if (prefixedBase !== 0 && (radix === 0 || radix === prefixedBase)) {
      radix = prefixedBase; start += 2;
      if (points[start] === 95) start++;
    } else leadingZero = radix === 0;
  }
  if (radix === 0) radix = 10;
  let count = 0, underscore = true, nonzero = false;
  for (let index = start; index < end; index++) {
    meter.checkpoint();
    const point = points[index];
    if (point === 95) {
      if (underscore) invalid();
      underscore = true; continue;
    }
    const digit = point >= 48 && point <= 57 ? point - 48 : point >= 65 && point <= 90 ? point - 55 : point >= 97 && point <= 122 ? point - 87 : -1;
    if (digit < 0 || digit >= radix) invalid();
    digits[count++] = digit; nonzero ||= digit !== 0; underscore = false;
  }
  if (underscore || count === 0) invalid();
  if (maxDigits !== 0 && (radix & (radix - 1)) !== 0 && count > maxDigits) throw new PythonRuntimeError("ValueError", `Exceeds the limit (${maxDigits} digits) for integer string conversion: value has ${count} digits; use sys.set_int_max_str_digits() to increase the limit`);
  if (leadingZero && nonzero) invalid();
  const parts: { value: bigint; digits: number }[] = [];
  for (let index = 0; index < count;) {
    let value = 0, length = 0;
    while (length < 5 && index < count) { meter.checkpoint(); value = value * radix + digits[index++]; length++; }
    meter.checkpoint(1, 72); parts.push({ value: BigInt(value), digits: length });
  }
  while (parts.length > 1) {
    let output = 0;
    for (let index = 0; index < parts.length; index += 2) {
      if (index + 1 === parts.length) { parts[output++] = parts[index]; continue; }
      const left = parts[index], right = parts[index + 1], length = left.digits + right.digits;
      const bits = Math.ceil(length * Math.log2(radix));
      meter.checkpoint(Math.max(1, Math.ceil(bits / 64)), 128 + 3 * Math.ceil(bits / 8));
      parts[output++] = { value: left.value * BigInt(radix) ** BigInt(right.digits) + right.value, digits: length };
    }
    parts.length = output;
  }
  meter.checkpoint(1, 32 + Math.ceil(count * Math.log2(radix) / 8));
  return negative ? -parts[0].value : parts[0].value;
}
