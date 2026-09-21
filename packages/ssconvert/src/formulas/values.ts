import type { CellValue } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";

export const blank: CellValue = Object.freeze({ kind: "blank" });
export const error = (value: string): CellValue => ({ kind: "error", value });
export const numericResult = (value: number): CellValue => Number.isFinite(value) ? { kind: "number", value: value === 0 ? 0 : value } : error("#NUM!");

/** Decimal C-locale numeric matching. Other format/date matching is not measured. */
export function numericText(source: string): number | undefined {
  let text = source.trim(), scale = 1;
  if (text.endsWith("%")) { scale = .01; text = text.slice(0, -1).trim(); }
  let offset = 0, digits = 0;
  if (text[offset] === "+" || text[offset] === "-") offset++;
  const digit = () => text[offset] !== undefined && text[offset]! >= "0" && text[offset]! <= "9";
  while (digit()) { digits++; offset++; }
  if (text[offset] === ".") { offset++; while (digit()) { digits++; offset++; } }
  if (!digits) return undefined;
  if (text[offset]?.toLowerCase() === "e") {
    offset++; if (text[offset] === "+" || text[offset] === "-") offset++;
    const start = offset; while (digit()) offset++;
    if (start === offset) return undefined;
  }
  if (offset !== text.length) return undefined;
  const value = Number(text) * scale;
  return Number.isFinite(value) ? value : undefined;
}
export function numeric(value: CellValue): number | undefined {
  return value.kind === "blank" ? 0 : value.kind === "number" ? value.value : value.kind === "boolean" ? Number(value.value) : value.kind === "string" ? numericText(value.value) : undefined;
}
/** GOAccumulator partial expansion, in go_range_sum's reverse input order. */
export function sum(values: readonly number[], tick: () => void): number {
  const partials: number[] = [];
  for (let index = values.length - 1; index >= 0; index--) {
    tick(); let x = values[index]!, retained = 0;
    for (let part = 0; part < partials.length; part++) {
      tick(); let y = partials[part]!;
      if (Math.abs(x) < Math.abs(y)) { const saved = x; x = y; y = saved; }
      const hi = x + y;
      if (!Number.isFinite(hi)) { x = hi; retained = 0; break; }
      const lo = y - (hi - x);
      if (lo !== 0) partials[retained++] = lo;
      x = hi;
    }
    partials.length = retained + 1; partials[retained] = x;
  }
  let result = 0;
  for (const part of partials) { tick(); result += part; }
  return result;
}
/** Scaled mantissas avoid intermediate over/underflow, as rangefunc.c does. */
export function product(values: readonly number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1 || values[0] === 0) return values[0]!;
  let mantissa = 1, exponent = 0;
  for (const value of values) {
    if (value === 0) return 0;
    // Normalize into (1/2, 1], including subnormal binary64 inputs.
    let power = Math.floor(Math.log2(Math.abs(value)));
    power = Math.max(-1074, Math.min(1023, power));
    let fraction = value / 2 ** power;
    if (Math.abs(fraction) > 1) { fraction /= 2; power++; }
    mantissa *= fraction; exponent += power;
    if (Math.abs(mantissa) <= .5) { mantissa *= 2; exponent--; }
  }
  if (exponent > 1024) return mantissa < 0 ? -Infinity : Infinity;
  if (exponent < -1074) return mantissa < 0 ? -0 : 0;
  return exponent === 1024 ? (mantissa * 2) * 2 ** 1023 : mantissa * 2 ** exponent;
}
export function rendered(value: CellValue): string {
  if (value.kind === "number") {
    // value_get_as_gstring's !^G format: binary64 shortest digits, C-locale
    // notation boundaries and printf exponent spelling (go-dtoa.c:fmt_shortest).
    const shortest = value.value.toExponential(), split = shortest.indexOf("e");
    const mantissa = shortest.slice(0, split), exponent = Number(shortest.slice(split + 1));
    if (exponent < -4 || exponent >= 17) return `${mantissa}E${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
    const dot = mantissa.indexOf("."), decimals = dot < 0 ? 0 : mantissa.length - dot - 1;
    return value.value.toFixed(Math.max(0, decimals - exponent));
  }
  return value.kind === "blank" ? "" : value.kind === "boolean" ? value.value ? "TRUE" : "FALSE" : String(value.value);
}
export function comparison(a: CellValue, b: CellValue): number {
  if (a.kind === "blank") a = b.kind === "string" ? { kind: "string", value: "" } : b.kind === "boolean" ? { kind: "boolean", value: false } : numericResult(0);
  if (b.kind === "blank") b = a.kind === "string" ? { kind: "string", value: "" } : a.kind === "boolean" ? { kind: "boolean", value: false } : numericResult(0);
  const rank = { blank: 0, number: 1, string: 2, boolean: 3, error: 4 };
  if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
  const x = a.kind === "string" ? foldSheetName(a.value) : a.kind === "blank" ? 0 : a.value;
  const y = b.kind === "string" ? foldSheetName(b.value) : b.kind === "blank" ? 0 : b.value;
  return x === y ? 0 : x < y ? -1 : 1;
}
/** value_diff's iteration metric is separate from spreadsheet comparison. */
export function difference(a: CellValue, b: CellValue): number {
  if (a.kind === "string" || b.kind === "string") {
    if (a.kind === "string" && b.kind === "string") return a.value === b.value ? 0 : Number.MAX_VALUE;
    const string = a.kind === "string" ? a : b, other = a.kind === "string" ? b : a;
    return string.kind === "string" && string.value === "" && other.kind === "blank" ? 0 : Number.MAX_VALUE;
  }
  if (a.kind === "boolean" && b.kind === "number" || b.kind === "boolean" && a.kind === "number") return Number.MAX_VALUE;
  // Native GnmValDiff.TYPE_MISMATCH has the numeric value 3.
  if (a.kind === "error" || b.kind === "error") return 3;
  if (a.kind === "boolean" || b.kind === "boolean") return (numeric(a) ?? 0) === (numeric(b) ?? 0) ? 0 : Number.MAX_VALUE;
  return Math.abs((numeric(a) ?? 0) - (numeric(b) ?? 0));
}
export function binary(op: string, left: CellValue, right: CellValue): CellValue {
  if (left.kind === "error") return left;
  if (op === "&") return right.kind === "error" ? right : { kind: "string", value: rendered(left) + rendered(right) };
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    if (right.kind === "error") return right;
    const order = comparison(left, right);
    return { kind: "boolean", value: op === "=" ? order === 0 : op === "<>" ? order !== 0 : op === "<" ? order < 0 : op === ">" ? order > 0 : op === "<=" ? order <= 0 : order >= 0 };
  }
  const a = numeric(left); if (a === undefined) return error("#VALUE!");
  if (right.kind === "error") return right;
  const b = numeric(right); if (b === undefined) return error("#VALUE!");
  if (op === "/" && b === 0) return error("#DIV/0!");
  if (op === "^" && (a === 0 && b <= 0 || a < 0 && (!Number.isInteger(b) || b < -2147483648 || b > 2147483647))) return error("#NUM!");
  return numericResult(op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : a ** b);
}
