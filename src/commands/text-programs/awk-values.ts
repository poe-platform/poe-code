import { ProgramError } from "./shared.js";

export type Scalar = { readonly kind: "number"; readonly number: number }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "numeric"; readonly text: string; readonly number: number }
  | { readonly kind: "unset" };
export class AwkArray { readonly entries = new Map<string, Scalar>(); }
export type Value = Scalar | AwkArray;
export const unset: Scalar = Object.freeze({ kind: "unset" });
export const numeric = (number: number): Scalar => ({ kind: "number", number });
export const string = (text: string): Scalar => ({ kind: "string", text });

export function inputValue(text: string): Scalar {
  return /^[ \t\r\n]*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\r\n]*$/u.test(text)
    ? { kind: "numeric", text, number: Number(text) } : string(text);
}

export function scalar(value: Value): Scalar {
  if (value instanceof AwkArray) throw new ProgramError("array used in scalar context");
  return value;
}

export function number(value: Scalar): number {
  if (value.kind === "unset") return 0;
  if (value.kind === "number" || value.kind === "numeric") return value.number;
  const prefix = /^[ \t\r\n]*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/u.exec(value.text)?.[0];
  return prefix === undefined ? 0 : Number(prefix);
}

export function truth(value: Scalar): boolean {
  return value.kind === "unset" ? false : value.kind === "number" || value.kind === "numeric" ? value.number !== 0 : value.text !== "";
}

function general(value: number, precision: number, alternate: boolean): string {
  precision = Math.max(1, precision);
  if (value === 0) return alternate ? (0).toFixed(precision - 1) : "0";
  const rounded = Number(value.toPrecision(precision));
  const exponent = Math.floor(Math.log10(Math.abs(rounded)));
  let result = exponent < -4 || exponent >= precision ? rounded.toExponential(precision - 1) : rounded.toFixed(Math.max(0, precision - exponent - 1));
  if (!alternate) result = result.replace(/(\.[0-9]*?)0+(?=e|$)/u, "$1").replace(/\.(?=e|$)/u, "");
  return result;
}

const formatPattern = /^%([-+ #0]*)(\*|[0-9]+)?(?:\.(\*|[0-9]*))?([csdiuoxXfFeEgG])/u;

export function validateFormat(format: string): void {
  for (let offset = 0; offset < format.length;) {
    if (format[offset] !== "%") { offset++; continue; }
    if (format[offset + 1] === "%") { offset += 2; continue; }
    const match = formatPattern.exec(format.slice(offset));
    if (!match) throw new ProgramError(`unsupported format near '${format.slice(offset)}'`);
    offset += match[0].length;
    if (match[2] !== "*" && Number(match[2] ?? 0) > 1_000_000 || match[3] !== "*" && Number(match[3] ?? 0) > (/[fFeEgG]/u.test(match[4]!) ? 100 : 1_000_000)) throw new ProgramError("excessive format width or precision");
  }
}

export function formatted(format: string, values: readonly Scalar[], text: (value: Scalar) => string): string {
  let result = "";
  let argument = 0;
  const take = () => { const value = values[argument++]; if (value === undefined) throw new ProgramError("not enough arguments for format"); return value; };
  for (let offset = 0; offset < format.length;) {
    if (format[offset] !== "%") { result += format[offset++]; continue; }
    if (format[offset + 1] === "%") { result += "%"; offset += 2; continue; }
    const match = formatPattern.exec(format.slice(offset));
    if (!match) throw new ProgramError(`unsupported format near '${format.slice(offset)}'`);
    offset += match[0].length;
    let flags = match[1]!;
    let width = match[2] === "*" ? Math.trunc(number(take())) : Number(match[2] ?? 0);
    let precision = match[3] === undefined ? undefined : match[3] === "*" ? Math.trunc(number(take())) : Number(match[3] || 0);
    if (width < 0) { flags += "-"; width = -width; }
    if (precision !== undefined && precision < 0) precision = undefined;
    const conversion = match[4]!;
    if (!Number.isSafeInteger(width) || width > 1_000_000 || precision !== undefined && (!Number.isSafeInteger(precision) || precision > (/[fFeEgG]/u.test(conversion) ? 100 : 1_000_000))) throw new ProgramError("excessive format width or precision");
    const value = take();
    let part: string;
    if (conversion === "s") part = text(value).slice(0, precision);
    else if (conversion === "c") part = value.kind === "string" ? value.text[0] ?? "\0" : String.fromCharCode(Math.trunc(number(value)) & 255);
    else {
      const amount = number(value);
      if (!Number.isFinite(amount)) throw new ProgramError("cannot format a non-finite number");
      if (conversion === "f" || conversion === "F") part = amount.toFixed(precision ?? 6);
      else if (conversion === "e" || conversion === "E") part = amount.toExponential(precision ?? 6);
      else if (conversion === "g" || conversion === "G") part = general(amount, precision ?? 6, flags.includes("#"));
      else {
        const radix = conversion === "o" ? 8 : conversion === "x" || conversion === "X" ? 16 : 10;
        const integer = BigInt(Math.trunc(amount));
        part = (/[uoxX]/u.test(conversion) ? BigInt.asUintN(32, integer) : integer).toString(radix);
        if (precision !== undefined) part = amount === 0 && precision === 0 ? "" : part.startsWith("-") ? `-${part.slice(1).padStart(precision, "0")}` : part.padStart(precision, "0");
        if (flags.includes("#") && amount !== 0) part = (radix === 16 ? "0x" : radix === 8 ? "0" : "") + part;
      }
      part = part.replace(/e([+-])([0-9])$/u, "e$10$2");
      if (/[XFEG]/u.test(conversion)) part = part.toUpperCase();
      if (amount >= 0 && !/[uoxX]/u.test(conversion)) part = (flags.includes("+") ? "+" : flags.includes(" ") ? " " : "") + part;
      if (flags.includes("#") && /[fFeE]/u.test(conversion) && !part.includes(".")) part = part.replace(/([eE]|$)/u, ".$1");
    }
    if (flags.includes("-")) part = part.padEnd(width, " ");
    else if (flags.includes("0") && /[diuoxXfFeEgG]/u.test(conversion) && (precision === undefined || /[fFeEgG]/u.test(conversion))) {
      const prefix = /^(?:[+ -]|0[xX])/u.exec(part)?.[0] ?? "";
      part = prefix + part.slice(prefix.length).padStart(Math.max(0, width - prefix.length), "0");
    } else part = part.padStart(width, " ");
    result += part;
    if (result.length > 32 * 1024 * 1024) throw new ProgramError("formatted output exceeds buffer limit");
  }
  return result;
}

export function text(value: Scalar, format = "%.6g"): string {
  if (value.kind === "unset") return "";
  if (value.kind !== "number") return value.text;
  if (Number.isInteger(value.number) && Math.abs(value.number) < 1e21) return String(value.number);
  return formatted(format, [value], argument => String(number(argument)));
}

export function compare(left: Scalar, right: Scalar, format: string): number {
  if (left.kind !== "string" && right.kind !== "string") {
    const first = number(left); const second = number(right);
    return first < second ? -1 : first > second ? 1 : 0;
  }
  const first = text(left, format); const second = text(right, format);
  return first < second ? -1 : first > second ? 1 : 0;
}
