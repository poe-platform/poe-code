import { PythonRuntimeError } from "./error.js";
import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { isAsciiWhitespace } from "./ascii-whitespace.js";
import { integerTrueDivide } from "./integer-arithmetic.js";

/** Keep 64 leading significand bits plus a sticky tail, enough to determine
 * every binary64 rounding decision. Exponents saturate beyond any cancellation
 * possible from the input's fractional digits. Numeric working storage stays
 * bounded independently of coefficient/exponent text length. */
export function floatFromHex(source: CodePointString, meter: ExecutionMeter): number {
  meter.checkpoint(1, 4096);
  let index = 0;
  const peek = () => index < source.length ? source.codePointAt(BigInt(index), meter) : -1;
  while (isAsciiWhitespace(peek())) index++;
  let negative = false;
  if (peek() === 43 || peek() === 45) { negative = peek() === 45; index++; }
  let special: number | undefined;
  if ((peek() | 32) === 105 || (peek() | 32) === 110) {
    let word = "";
    while (peek() >= 0 && !isAsciiWhitespace(peek())) {
      if (word.length === 8 || peek() > 127) throw new PythonRuntimeError("ValueError", "invalid hexadecimal floating-point string");
      word += String.fromCharCode(peek() | 32); index++;
    }
    if (word === "inf" || word === "infinity") special = Infinity;
    else if (word === "nan") special = NaN;
    else throw new PythonRuntimeError("ValueError", "invalid hexadecimal floating-point string");
  }
  if (special !== undefined) {
    while (isAsciiWhitespace(peek())) index++;
    if (index !== source.length) throw new PythonRuntimeError("ValueError", "invalid hexadecimal floating-point string");
    return negative ? -special : special;
  }
  if (peek() === 48 && index + 1 < source.length && (source.codePointAt(BigInt(index + 1), meter) | 32) === 120) index += 2;
  let coefficient = 0n, kept = 0, omitted = 0, fractional = 0, digits = 0, dot = false, sticky = false;
  while (true) {
    const point = peek();
    if (point === 46 && !dot) { dot = true; index++; continue; }
    const digit = point >= 48 && point <= 57 ? point - 48 : point >= 65 && point <= 70 ? point - 55 : point >= 97 && point <= 102 ? point - 87 : -1;
    if (digit < 0) break;
    digits++; if (dot) fractional++;
    if (kept !== 0 || digit !== 0) {
      if (kept < 16) { coefficient = (coefficient << 4n) | BigInt(digit); kept++; }
      else { omitted++; sticky ||= digit !== 0; }
    }
    index++;
  }
  if (digits === 0) throw new PythonRuntimeError("ValueError", "invalid hexadecimal floating-point string");
  let exponent = 0;
  if ((peek() | 32) === 112) {
    index++; let exponentNegative = false;
    if (peek() === 43 || peek() === 45) { exponentNegative = peek() === 45; index++; }
    const start = index, cap = source.length * 4 + 4096;
    while (peek() >= 48 && peek() <= 57) { exponent = Math.min(cap, exponent * 10 + peek() - 48); index++; }
    if (index === start) throw new PythonRuntimeError("ValueError", "invalid hexadecimal floating-point string");
    if (exponentNegative) exponent = -exponent;
  }
  // CPython rounds the parsed coefficient before checking trailing text.
  // Both direct overflow and overflow from rounding outrank trailing syntax;
  // zero and underflow still require the remainder to be valid whitespace.
  let result = 0;
  if (coefficient !== 0n) {
    exponent += 4 * (omitted - fractional);
    if (sticky) { coefficient = (coefficient << 1n) | 1n; exponent--; }
    const topExponent = exponent + coefficient.toString(2).length - 1;
    if (topExponent > 1023) throw new PythonRuntimeError("OverflowError", "hexadecimal value too large to represent as a float");
    if (topExponent >= -1075) {
      meter.checkpoint();
      try {
        result = exponent >= 0 ? integerTrueDivide(coefficient << BigInt(exponent), 1n) : integerTrueDivide(coefficient, 1n << BigInt(-exponent));
      } catch (error) {
        if (error instanceof PythonRuntimeError && error.name === "OverflowError") throw new PythonRuntimeError("OverflowError", "hexadecimal value too large to represent as a float");
        throw error;
      }
    }
  }
  while (isAsciiWhitespace(peek())) index++;
  if (index !== source.length) throw new PythonRuntimeError("ValueError", "invalid hexadecimal floating-point string");
  return negative ? -result : result;
}
