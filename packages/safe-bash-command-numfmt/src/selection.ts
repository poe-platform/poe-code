import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { blank, digit, quote, NumfmtDiagnostic } from "./presentation.js";
const unsignedMaximum = (1n << 64n) - 1n;
export const unitPrefixes = "KMGTPEZYRQ";

export function decimal(text: string, offset = 0): { value: bigint; end: number; found: boolean; overflow: boolean } {
  const start = offset;
  while (text[offset] === " " || (text.charCodeAt(offset) >= 9 && text.charCodeAt(offset) <= 13)) offset++;
  const negative = text[offset] === "-";
  if (negative || text[offset] === "+") offset++;
  const digits = offset;
  let value = 0n;
  while (digit(text[offset])) { if (value <= unsignedMaximum) value = value * 10n + BigInt(text.charCodeAt(offset) - 48); offset++; }
  return { value: negative ? -value : value, end: offset === digits ? start : offset, found: offset !== digits, overflow: value > unsignedMaximum };
}

export function fields(text: string, unicode: boolean, maxFieldRanges: number): [bigint, bigint][] {
  const result: [bigint, bigint][] = [];
  let initial = 1n;
  let value = 0n;
  let dash = false;
  let left = false;
  let right = false;
  let digitsStart = 0;
  for (let offset = 0; ; offset++) {
    const character = text[offset];
    if (character === "-") {
      if (dash) throw new NumfmtDiagnostic("invalid field range", 1, true);
      if (left && value === 0n) throw new NumfmtDiagnostic("fields are numbered from 1", 1, true);
      dash = true;
      initial = left ? value : 1n;
      value = 0n;
    } else if (character === undefined || character === "," || blank(character)) {
      if (dash) {
        if (right && value < initial) throw new NumfmtDiagnostic("invalid decreasing range", 1, true);
        result.push([initial, right ? value : unsignedMaximum]);
      } else {
        if (!value) throw new NumfmtDiagnostic("fields are numbered from 1", 1, true);
        result.push([value, value]);
      }
      if (result.length > maxFieldRanges) throw new PublicDiagnostic("field range limit exceeded");
      if (character === undefined) break;
      value = 0n; dash = false; left = false; right = false;
    } else if (digit(character)) {
      if (!digit(text[offset - 1])) digitsStart = offset;
      if (dash) right = true; else left = true;
      value = value * 10n + BigInt(character.charCodeAt(0) - 48);
      if (value >= unsignedMaximum) {
        let end = offset + 1;
        while (digit(text[end])) end++;
        throw new NumfmtDiagnostic(`field number ${quote(text.slice(digitsStart, end), unicode)} is too large`, 1, true);
      }
    } else throw new NumfmtDiagnostic(`invalid field value ${quote(text.slice(offset), unicode)}`, 1, true);
  }
  result.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const merged: [bigint, bigint][] = [];
  for (const range of result) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) { if (range[1] > previous[1]) previous[1] = range[1]; }
    else merged.push(range);
  }
  return merged;
}

export function unit(text: string, unicode: boolean): bigint {
  const parsed = decimal(text);
  let value = parsed.value;
  let tail = text.slice(parsed.end);
  if (!parsed.found && unitPrefixes.includes(text[0] ?? "\0")) { value = 1n; tail = text; }
  let valid = parsed.found || value === 1n;
  if (tail) {
    const power = unitPrefixes.indexOf(tail[0]!) + 1;
    valid &&= power > 0 && (tail.length === 1 || tail.length === 2 && tail[1] === "i");
    if (valid) value *= BigInt(tail.length === 2 ? 1024 : 1000) ** BigInt(power);
  }
  if (!valid || parsed.overflow || value <= 0n || value > unsignedMaximum) throw new NumfmtDiagnostic(`invalid unit size: ${quote(text, unicode)}`);
  return value;
}

