import { ProgramError, type Budget } from "./shared.js";

export type Scalar = { readonly kind: "number"; readonly number: number }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "numeric"; readonly text: string; readonly number: number }
  | { readonly kind: "unset" };
export class AwkArray { readonly entries = new Map<string, Scalar>(); }
export type Value = Scalar | AwkArray;
export const unset: Scalar = Object.freeze({ kind: "unset" });
const SMALL_NUMERICS: readonly Scalar[] = Array.from({ length: 4098 }, (_, i) => Object.freeze({ kind: "number" as const, number: i - 1 }));
const SMALL_NUMERIC_STRINGS: readonly Scalar[] = Array.from({ length: 1024 }, (_, i) => Object.freeze({ kind: "numeric" as const, text: String(i), number: i }));
const EMPTY_STRING_SCALAR: Scalar = Object.freeze({ kind: "string", text: "" });
const INPUT_STRING_CACHE_KEYS = new Array<string>(64);
const INPUT_STRING_CACHE_VALS = new Array<Scalar>(64);

export const numeric = (n: number): Scalar =>
  (n | 0) === n && n >= -1 && n <= 4096 && (n !== 0 || 1 / n > 0)
    ? SMALL_NUMERICS[n + 1]!
    : { kind: "number", number: n };
export const string = (text: string): Scalar => (text.length === 0 ? EMPTY_STRING_SCALAR : { kind: "string", text });

export function inputValue(text: string): Scalar {
  const len = text.length;
  if (len === 0) return EMPTY_STRING_SCALAR;
  const first = text.charCodeAt(0);
  if (first >= 48 && first <= 57 && len <= 15) {
    let num = first - 48;
    let allDigits = true;
    for (let i = 1; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c < 48 || c > 57) {
        allDigits = false;
        break;
      }
      num = num * 10 + (c - 48);
    }
    if (allDigits) {
      if (num < 1024 && (len === 1 || first !== 48)) return SMALL_NUMERIC_STRINGS[num]!;
      return { kind: "numeric", text, number: num };
    }
  }
  if (first > 57 || (first < 48 && first !== 32 && first !== 9 && first !== 10 && first !== 13 && first !== 43 && first !== 45 && first !== 46)) {
    if (len <= 12) {
      const slot = ((first * 31 + text.charCodeAt(len - 1) * 17 + len) & 63);
      if (INPUT_STRING_CACHE_KEYS[slot] === text) return INPUT_STRING_CACHE_VALS[slot]!;
      const flat = Buffer.from(text, "latin1").toString("latin1");
      const val: Scalar = Object.freeze({ kind: "string", text: flat });
      INPUT_STRING_CACHE_KEYS[slot] = flat;
      INPUT_STRING_CACHE_VALS[slot] = val;
      return val;
    }
    return { kind: "string", text };
  }
  return /^[ \t\r\n]*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\r\n]*$/u.test(text)
    ? { kind: "numeric", text, number: Number(text) } : string(text);
}

export function inputValueFromSlice(record: string, start: number, end: number): Scalar {
  const len = end - start;
  if (len <= 0) return EMPTY_STRING_SCALAR;
  const first = record.charCodeAt(start);
  if (first >= 48 && first <= 57 && len <= 15) {
    let num = first - 48;
    let allDigits = true;
    for (let i = start + 1; i < end; i++) {
      const c = record.charCodeAt(i);
      if (c < 48 || c > 57) {
        allDigits = false;
        break;
      }
      num = num * 10 + (c - 48);
    }
    if (allDigits) {
      if (num < 1024 && (len === 1 || first !== 48)) return SMALL_NUMERIC_STRINGS[num]!;
      return { kind: "numeric", text: record.slice(start, end), number: num };
    }
  }
  if (first > 57 || (first < 48 && first !== 32 && first !== 9 && first !== 10 && first !== 13 && first !== 43 && first !== 45 && first !== 46)) {
    if (len <= 12) {
      const slot = ((first * 31 + record.charCodeAt(end - 1) * 17 + len) & 63);
      const cachedKey = INPUT_STRING_CACHE_KEYS[slot];
      if (cachedKey !== undefined && cachedKey.length === len && record.startsWith(cachedKey, start)) {
        return INPUT_STRING_CACHE_VALS[slot]!;
      }
      const flat = Buffer.from(record.slice(start, end), "latin1").toString("latin1");
      const val: Scalar = Object.freeze({ kind: "string", text: flat });
      INPUT_STRING_CACHE_KEYS[slot] = flat;
      INPUT_STRING_CACHE_VALS[slot] = val;
      return val;
    }
    return { kind: "string", text: record.slice(start, end) };
  }
  return inputValue(record.slice(start, end));
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

// A binary64 value has a finite exact decimal expansion. Use it when the
// requested precision exceeds Number's formatting API, then pad only after admission.
function preciseFloat(value: number, precision: number, conversion: string, alternate: boolean, admit: (length: number) => void): string {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0);
  const exponentBits = Number(bits >> 52n & 2047n);
  let mantissa = bits & ((1n << 52n) - 1n);
  if (exponentBits) mantissa += 1n << 52n;
  const power = (exponentBits || 1) - 1023 - 52;
  const digits = (power >= 0 ? mantissa << BigInt(power) : mantissa * 5n ** BigInt(-power)).toString();
  const point = digits.length + Math.min(0, power);
  const negative = value < 0 ? "-" : "";
  if (conversion.toLowerCase() === "f") {
    admit(Math.max(1, value === 0 ? 1 : point) + precision + 1 + negative.length);
    const count = point + precision;
    let scaled = count >= digits.length ? digits.padEnd(count, "0") : count <= 0 ? "0" : digits.slice(0, count);
    if (count >= 0 && count < digits.length && Number(digits[count]) >= 5) scaled = (BigInt(scaled) + 1n).toString();
    scaled = scaled.padStart(precision + 1, "0");
    return negative + scaled.slice(0, -precision) + "." + scaled.slice(-precision);
  }
  const significant = conversion.toLowerCase() === "g" ? precision : precision + 1;
  const exact = digits.replace(/^0+/u, "") || "0";
  const exponent = value === 0 ? 0 : point - 1;
  // Above 100 significant digits there can be no carry that changes binary64's
  // decimal exponent, but the remaining exact digits still require rounding.
  let rounded = exact.slice(0, significant);
  if (exact.length > significant && Number(exact[significant]) >= 5) rounded = (BigInt(rounded) + 1n).toString();
  const exponential = conversion.toLowerCase() === "e" || exponent < -4 || exponent >= significant;
  const padded = conversion.toLowerCase() !== "g" || alternate;
  if (padded) {
    admit(negative.length + (exponential ? significant + 3 + Math.max(2, String(Math.abs(exponent)).length) : significant + 1 + Math.max(0, -exponent)));
    rounded = rounded.padEnd(significant, "0");
  } else rounded = rounded.replace(/0+$/u, "") || "0";
  let result: string;
  if (exponential) {
    result = rounded[0] + "." + rounded.slice(1) + "e" + (exponent < 0 ? "-" : "+") + Math.abs(exponent);
  } else {
    const decimalPoint = exponent + 1;
    result = decimalPoint <= 0 ? "0." + "0".repeat(-decimalPoint) + rounded : rounded.slice(0, decimalPoint).padEnd(decimalPoint, "0") + "." + rounded.slice(decimalPoint);
  }
  if (conversion.toLowerCase() === "g" && !alternate) result = result.replace(/(\.[0-9]*?)0+(?=e|$)/u, "$1").replace(/\.(?=e|$)/u, "");
  return negative + result;
}

// Bound synchronous parsing even for literal validation, which has no runtime budget.
const maxFormatLength = 64 * 1024;

function scanFormat(format: string, offset: number) {
  let cursor = offset + 1;
  const flagsStart = cursor;
  while (cursor < format.length && "-+ #0".includes(format[cursor]!)) cursor++;
  const flags = format.slice(flagsStart, cursor);
  const amount = (): string => {
    const start = cursor;
    if (format[cursor] === "*") cursor++;
    else while (cursor < format.length && format[cursor]! >= "0" && format[cursor]! <= "9") cursor++;
    return format.slice(start, cursor);
  };
  const width = amount();
  let precision: string | undefined;
  if (format[cursor] === ".") { cursor++; precision = amount(); }
  const conversion = format[cursor];
  if (conversion === undefined || !"csdiuoxXfFeEgG".includes(conversion)) {
    throw new ProgramError(`unsupported format near '${format.slice(offset)}'`);
  }
  return { end: cursor + 1, flags, width, precision, conversion };
}

export function validateFormat(format: string): void {
  if (format.length > maxFormatLength) throw new ProgramError("format length limit exceeded");
  for (let offset = 0; offset < format.length;) {
    if (format[offset] !== "%") { offset++; continue; }
    if (format[offset + 1] === "%") { offset += 2; continue; }
    const match = scanFormat(format, offset);
    offset = match.end;
    if (match.width !== "*" && !Number.isSafeInteger(Number(match.width ?? 0)) || match.precision !== "*" && (!Number.isSafeInteger(Number(match.precision ?? 0)))) throw new ProgramError("excessive format width or precision");
  }
}

export function formatted(format: string, values: readonly Scalar[], text: (value: Scalar) => string, budget?: Budget): string {
  if (format.length > maxFormatLength) throw new ProgramError("format length limit exceeded");
  budget?.step(format.length);
  let result = "";
  let argument = 0;
  const limit = budget?.maxBufferBytes ?? Infinity;
  const admit = (length: number): void => {
    budget?.step(0);
    if (length > limit - result.length) throw new ProgramError("text buffer limit exceeded");
    budget?.step(length);
  };
  const amountOf = (value: Scalar): number => {
    // Numeric scalars already own a parsed number; strings require a prefix scan.
    budget?.step(value.kind === "string" ? value.text.length : 0);
    return number(value);
  };
  const take = () => { const value = values[argument++]; if (value === undefined) throw new ProgramError("not enough arguments for format"); return value; };
  for (let offset = 0; offset < format.length;) {
    if (format[offset] !== "%") { admit(1); result += format[offset++]; continue; }
    if (format[offset + 1] === "%") { admit(1); result += "%"; offset += 2; continue; }
    const match = scanFormat(format, offset);
    offset = match.end;
    let flags = match.flags;
    let width = match.width === "*" ? Math.trunc(amountOf(take())) : Number(match.width ?? 0);
    let precision = match.precision === undefined ? undefined : match.precision === "*" ? Math.trunc(amountOf(take())) : Number(match.precision || 0);
    if (width < 0) { flags += "-"; width = -width; }
    if (precision !== undefined && precision < 0) precision = undefined;
    const conversion = match.conversion;
    if (!Number.isSafeInteger(width) || precision !== undefined && (!Number.isSafeInteger(precision))) throw new ProgramError("excessive format width or precision");
    const value = take();
    let part: string;
    if (conversion === "s") {
      const source = text(value);
      admit(Math.min(source.length, precision ?? source.length));
      part = source.slice(0, precision);
    } else if (conversion === "c") {
      admit(1);
      part = value.kind === "string" ? value.text[0] ?? "\0" : String.fromCharCode(Math.trunc(amountOf(value)) & 255);
    } else {
      const amount = amountOf(value);
      if (!Number.isFinite(amount)) throw new ProgramError("cannot format a non-finite number");
      // Charge requested rendering work before numeric formatting or padding.
      budget?.step(1 + (/[fFeEgG]/u.test(conversion) ? precision ?? 6 : 0));
      if (/[fFeEgG]/u.test(conversion) && (precision ?? 6) > 100) {
        part = preciseFloat(amount, precision!, conversion, flags.includes("#"), admit);
      } else if (conversion === "f" || conversion === "F") part = amount.toFixed(precision ?? 6);
      else if (conversion === "e" || conversion === "E") part = amount.toExponential(precision ?? 6);
      else if (conversion === "g" || conversion === "G") part = general(amount, precision ?? 6, flags.includes("#"));
      else {
        const radix = conversion === "o" ? 8 : conversion === "x" || conversion === "X" ? 16 : 10;
        const integer = BigInt(Math.trunc(amount));
        part = (/[uoxX]/u.test(conversion) ? BigInt.asUintN(32, integer) : integer).toString(radix);
        if (precision !== undefined) {
          const negative = part.startsWith("-");
          admit(amount === 0 && precision === 0 ? 0 : Math.max(part.length, precision + Number(negative)));
          part = amount === 0 && precision === 0 ? "" : negative ? `-${part.slice(1).padStart(precision, "0")}` : part.padStart(precision, "0");
        }
        if (flags.includes("#") && amount !== 0) {
          const prefix = radix === 16 ? "0x" : radix === 8 ? "0" : "";
          admit(prefix.length + part.length);
          part = prefix + part;
        }
      }
      admit(part.length);
      part = part.replace(/e([+-])([0-9])$/u, "e$10$2");
      if (/[XFEG]/u.test(conversion)) { admit(part.length); part = part.toUpperCase(); }
      if (amount >= 0 && !/[uoxX]/u.test(conversion)) {
        const prefix = flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
        admit(prefix.length + part.length);
        part = prefix + part;
      }
      if (flags.includes("#") && /[fFeE]/u.test(conversion)) {
        budget?.step(part.length);
        if (!part.includes(".")) { admit(part.length + 1); part = part.replace(/([eE]|$)/u, ".$1"); }
      }
    }
    admit(Math.max(part.length, width));
    if (flags.includes("-")) part = part.padEnd(width, " ");
    else if (flags.includes("0") && /[diuoxXfFeEgG]/u.test(conversion) && (precision === undefined || /[fFeEgG]/u.test(conversion))) {
      const prefix = /^(?:[+ -]|0[xX])/u.exec(part)?.[0] ?? "";
      part = prefix + part.slice(prefix.length).padStart(Math.max(0, width - prefix.length), "0");
    } else part = part.padStart(width, " ");
    admit(part.length);
    result += part;
  }
  return result;
}

export function text(value: Scalar, format = "%.6g", budget?: Budget): string {
  if (value.kind === "unset") return "";
  if (value.kind !== "number") return value.text;
  if (Number.isInteger(value.number) && Math.abs(value.number) < 1e21) {
    budget?.step(0);
    const result = String(value.number);
    budget?.check(result);
    budget?.step(result.length);
    return result;
  }
  return formatted(format, [value], argument => String(number(argument)), budget);
}

export function compare(left: Scalar, right: Scalar, format: string, budget?: Budget): number {
  if (left.kind !== "string" && right.kind !== "string") {
    const first = number(left); const second = number(right);
    return first < second ? -1 : first > second ? 1 : 0;
  }
  const first = text(left, format, budget); const second = text(right, format, budget);
  return first < second ? -1 : first > second ? 1 : 0;
}
