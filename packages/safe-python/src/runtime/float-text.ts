import { CodePointString } from "./code-point-string.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { renderQuotedPoints } from "./quoted-representation.js";
import { unicodeDecimal } from "./unicode-decimal.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";

/** Python float text grammar, separate from source literals and numeric protocol
 * conversion. Only validated decimal ASCII reaches the host binary64 parser.
 * Buffer owners may supply lazy original-object repr for syntax errors. */
export function parseFloatText(input: CodePointString | ImmutableBytes, meter: ExecutionMeter, invalidRepresentation?: () => CodePointString): number {
  meter.checkpoint(1, input.length * 4);
  const text = input instanceof CodePointString, points = new Uint32Array(input.length);
  let offset = 0;
  for (let point of input) {
    meter.checkpoint();
    if (text && point > 127) {
      const digit = unicodeDecimal(point,meter);
      if (digit >= 0) point = 48 + digit;
      else if (isUnicodeWhitespace(point)) point = 32;
    }
    points[offset++] = point;
  }
  const invalid = (): never => {
    const quoted = invalidRepresentation===undefined?renderQuotedPoints(input,text ? "repr" : "bytes",meter):invalidRepresentation();
    let representation = "";
    for (const point of quoted) { meter.checkpoint(1,point > 0xffff ? 4 : 2); representation += String.fromCodePoint(point); }
    throw new PythonRuntimeError("ValueError", `could not convert string to float: ${representation}`);
  };
  const whitespace = (point: number): boolean => point === 32 || (point >= 9 && point <= 13);
  const digit = (point: number): boolean => point >= 48 && point <= 57;
  let start = 0, end = points.length;
  while (start < end && whitespace(points[start])) { meter.checkpoint(); start++; }
  while (end > start && whitespace(points[end-1])) { meter.checkpoint(); end--; }
  const numberStart = start;
  let negative = false;
  if (points[start] === 43 || points[start] === 45) { negative = points[start] === 45; start++; }
  const word = (expected: string): boolean => {
    if (end-start !== expected.length) return false;
    for (let index=0;index<expected.length;index++) { meter.checkpoint(); if ((points[start+index] | 32) !== expected.charCodeAt(index)) return false; }
    return true;
  };
  if (word("inf") || word("infinity")) return negative ? -Infinity : Infinity;
  if (word("nan")) {
    // Some transpilers fold -NaN into NaN, discarding its observable sign bit.
    meter.checkpoint(1,40);
    const bits = new DataView(new ArrayBuffer(8));
    bits.setBigUint64(0,negative ? 0xfff8000000000000n : 0x7ff8000000000000n);
    return bits.getFloat64(0);
  }
  let index = start;
  const digits = (): number => {
    let count = 0;
    while (index < end) {
      meter.checkpoint();
      if (digit(points[index])) { count++; index++; }
      else if (points[index] === 95) {
        if (count === 0 || !digit(points[index+1])) invalid();
        index++;
      } else break;
    }
    return count;
  };
  let count = digits();
  if (points[index] === 46) { index++; count += digits(); }
  if (count === 0) invalid();
  if (points[index] === 69 || points[index] === 101) {
    index++;
    if (points[index] === 43 || points[index] === 45) index++;
    if (digits() === 0) invalid();
  }
  if (index !== end) invalid();
  let normalized = "";
  for (let index=numberStart;index<end;index++) {
    meter.checkpoint();
    if (points[index] !== 95) { meter.checkpoint(0,2); normalized += String.fromCharCode(points[index]); }
  }
  meter.checkpoint(Math.max(1,Math.ceil(normalized.length/64)),8);
  return Number(normalized);
}
