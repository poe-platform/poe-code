import { ProgramError, type Budget } from "./shared.js";

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

const formatPattern = /^%([-+ #0]*)(\*|[0-9]+)?(?:\.(\*|[0-9]*))?([csdiuoxXfFeEgG])/u;

export function validateFormat(format: string): void {
  for (let offset = 0; offset < format.length;) {
    if (format[offset] !== "%") { offset++; continue; }
    if (format[offset + 1] === "%") { offset += 2; continue; }
    const match = formatPattern.exec(format.slice(offset));
    if (!match) throw new ProgramError(`unsupported format near '${format.slice(offset)}'`);
    offset += match[0].length;
    if (match[2] !== "*" && !Number.isSafeInteger(Number(match[2] ?? 0)) || match[3] !== "*" && (!Number.isSafeInteger(Number(match[3] ?? 0)))) throw new ProgramError("excessive format width or precision");
  }
}

export function formatted(format: string, values: readonly Scalar[], text: (value: Scalar) => string, budget?: Budget): string {
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
    const match = formatPattern.exec(format.slice(offset));
    if (!match) throw new ProgramError(`unsupported format near '${format.slice(offset)}'`);
    offset += match[0].length;
    let flags = match[1]!;
    let width = match[2] === "*" ? Math.trunc(amountOf(take())) : Number(match[2] ?? 0);
    let precision = match[3] === undefined ? undefined : match[3] === "*" ? Math.trunc(amountOf(take())) : Number(match[3] || 0);
    if (width < 0) { flags += "-"; width = -width; }
    if (precision !== undefined && precision < 0) precision = undefined;
    const conversion = match[4]!;
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
