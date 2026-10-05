import { SsconvertError } from "../../contracts.js";
import type { CellValue } from "@poe-code/spreadsheet-ast";
import { boundedText } from "./common.js";
import { rendered } from "../values.js";
import type { FunctionHost, Value } from "./types.js";
import { nonPrintable } from "./python-printf-profile.js";
import { inUnicodeRanges, type PythonUnicodeProfile } from "./python-unicode-profile.js";

type PythonValue = string | number | boolean | null | { readonly columns: readonly (readonly PythonValue[])[] } | { readonly range: number };
class PythonFormatError extends Error {
  constructor(readonly type: "TypeError" | "ValueError", message: string) { super(message); }
}
function floatText(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "nan" : value < 0 ? "-inf" : "inf";
  const [mantissa, exponent] = value.toExponential().split("e"), power = Number(exponent);
  if (power < -4 || power >= 16)
    return mantissa + "e" + (power < 0 ? "-" : "+") + String(Math.abs(power)).padStart(2, "0");
  const text = String(value);
  return text.includes(".") ? text : text + ".0";
}
function* pythonText(profile: PythonUnicodeProfile, value: PythonValue, repr: boolean, ascii: boolean, host: FunctionHost): Generator<string> {
  host.tick();
  if (value === null) { yield* "None"; return; }
  if (typeof value === "number") { yield* floatText(value); return; }
  if (typeof value === "boolean") { yield* value ? "True" : "False"; return; }
  if (typeof value === "object") {
    if ("range" in value) {
      // CPython uses a process address. The portable loader uses an opaque,
      // call-local identity for each newly allocated reference wrapper instead.
      yield* "<RangeRef object at 0x" + value.range.toString(16) + ">";
      return;
    }
    yield "[";
    for (let column = 0; column < value.columns.length; column++) {
      if (column) yield* ", ";
      yield "[";
      const cells = value.columns[column]!;
      for (let row = 0; row < cells.length; row++) {
        if (row) yield* ", ";
        yield* pythonText(profile, cells[row]!, true, ascii, host);
      }
      yield "]";
    }
    yield "]"; return;
  }
  if (!repr) { yield* value; return; }
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  yield quote;
  for (const char of value) {
    host.tick(); const code = char.codePointAt(0)!;
    if (char === quote || char === "\\") yield* "\\" + char;
    else if (char === "\n") yield* "\\n";
    else if (char === "\r") yield* "\\r";
    else if (char === "\t") yield* "\\t";
    else if (ascii && code > 127 || inUnicodeRanges(code, nonPrintable) || inUnicodeRanges(code, profile.nonPrintable))
      yield* code <= 255 ? "\\x" + code.toString(16).padStart(2, "0") : code <= 65535 ?
        "\\u" + code.toString(16).padStart(4, "0") : "\\U" + code.toString(16).padStart(8, "0");
    else yield char;
  }
  yield quote;
}
function pythonValue(value: Value | undefined, host: FunctionHost, references: { count: number }, argument = true): PythonValue {
  host.tick();
  // The node loader evaluates arguments without PERMIT_EMPTY; array children
  // are converted directly and retain Python None for empty Gnumeric values.
  if (value === undefined || value.kind === "blank") return argument ? 0 : null;
  if (value.kind === "error") {
    host.diagnostic?.({ code: "python-loader", severity: "warning", message: "gnm_value_to_py_obj: unsupported value type" });
    return null;
  }
  if (value.kind === "range") return { range: ++references.count };
  if (value.kind === "matrix" || value.kind === "set") {
    const rows = host.matrix(value).rows;
    return { columns: Array.from({ length: rows[0]?.length ?? 0 }, (_, column) =>
      rows.map(row => pythonValue(row[column], host, references, false))) };
  }
  // Both Python C-string acquisition and returned Gnumeric strings stop at NUL.
  return typeof value.value === "string" ? rendered(value).split("\0", 1)[0]! : value.value;
}
function decimalRatio(value: number): readonly [bigint, bigint] {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = exponent ? exponent - 1075 : -1074;
  return shift >= 0 ? [mantissa << BigInt(shift), 1n] : [mantissa, 1n << BigInt(-shift)];
}
function decimalRound(numerator: bigint, denominator: bigint, power: number): bigint {
  if (power >= 0) numerator *= 10n ** BigInt(power);
  else denominator *= 10n ** BigInt(-power);
  let result = numerator / denominator;
  const remainder = numerator % denominator * 2n;
  if (remainder > denominator || remainder === denominator && result % 2n) result++;
  return result;
}
function decimalFloat(value: number, kind: string, precision: number, alternate: boolean, host: FunctionHost): string {
  for (let i = 0; i < precision; i++) host.tick();
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "nan" : "inf";
  const [numerator, denominator] = decimalRatio(value);
  if (kind === "f") {
    const digits = decimalRound(numerator, denominator, precision).toString().padStart(precision + 1, "0");
    return precision ? digits.slice(0, -precision) + "." + digits.slice(-precision) : digits + (alternate ? "." : "");
  }
  let exponent = value ? Number(value.toExponential().split("e")[1]) : 0;
  const compare = (power: number) => power >= 0 ? numerator - denominator * 10n ** BigInt(power) : numerator * 10n ** BigInt(-power) - denominator;
  if (value) {
    while (compare(exponent) < 0n) { host.tick(); exponent--; }
    while (compare(exponent + 1) >= 0n) { host.tick(); exponent++; }
  }
  const count = kind === "e" ? precision + 1 : Math.max(1, precision);
  let rounded = decimalRound(numerator, denominator, count - 1 - exponent);
  if (rounded.toString().length > count) { rounded /= 10n; exponent++; }
  const digits = rounded.toString().padStart(count, "0");
  const scientific = kind === "e" || exponent < -4 || exponent >= count;
  let text: string;
  if (scientific) text = digits[0]! + (count > 1 ? "." + digits.slice(1) : alternate ? "." : "");
  else {
    const point = exponent + 1;
    text = point <= 0 ? "0." + "0".repeat(-point) + digits : point < count ?
      digits.slice(0, point) + "." + digits.slice(point) : digits + (alternate ? "." : "");
  }
  if (kind === "g" && !alternate && text.includes(".")) {
    while (text.endsWith("0")) text = text.slice(0, -1);
    if (text.endsWith(".")) text = text.slice(0, -1);
  }
  return text + (scientific ? "e" + (exponent < 0 ? "-" : "+") + String(Math.abs(exponent)).padStart(2, "0") : "");
}

/** Bounded Python Unicode percent formatting, from the released PY_PRINTF sample. */
export function pythonPrintf(profile: PythonUnicodeProfile, args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  if (!args.length) return { kind: "error", value: "Python exception (<class 'TypeError'>: func_printf() missing 1 required positional argument: 'format')" };
  const references = { count: 0 };
  const values = args.map(value => pythonValue(value, host, references)), format = values[0];
  // Activated 1.12.61 loaders on CPython 3.12 and 3.14 wrap the sample's
  // GnumericError rather than recognizing it in py_exc_to_string.
  if (typeof format !== "string") return { kind: "error", value: "Python exception (<class 'Gnumeric.GnumericError'>: #VALUE!)" };
  const chars = Array.from(format), limit = host.context.limits.outputBytes;
  let result = "", used = 0, bytes = 0;
  const append = (text: string) => {
    for (const char of text) {
      host.tick(); const code = char.codePointAt(0)!;
      bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
      if (bytes > limit) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    }
    result += text;
  };
  const take = (): PythonValue => {
    if (++used >= values.length) throw new PythonFormatError("TypeError", "not enough arguments for format string");
    return values[used]!;
  };
  try {
    for (let index = 0; index < chars.length; index++) {
      host.tick();
      if (chars[index] !== "%") { append(chars[index]!); continue; }
      if (chars[++index] === "%") { append("%"); continue; }
      if (chars[index] === "(") {
        throw new PythonFormatError("TypeError", "format requires a mapping");
      }
      let left = false, zero = false, plus = false, space = false, alternate = false;
      while (chars[index] !== undefined && "-+ #0".includes(chars[index]!)) {
        host.tick(); const flag = chars[index++]!;
        if (flag === "-") left = true; if (flag === "0") zero = true;
        if (flag === "+") plus = true; if (flag === " ") space = true; if (flag === "#") alternate = true;
      }
      const operand = (): number => {
        if (chars[index] === "*") {
          index++; const value = take();
          if (typeof value !== "boolean") throw new PythonFormatError("TypeError", "* wants int");
          return Number(value);
        }
        let count = 0;
        while (chars[index] !== undefined && chars[index]! >= "0" && chars[index]! <= "9") {
          host.tick(); count = count * 10 + Number(chars[index++]);
          if (count > limit) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
        }
        return count;
      };
      const width = operand();
      let precision: number | undefined;
      if (chars[index] === ".") { index++; precision = operand(); }
      if (chars[index] !== undefined && "hlL".includes(chars[index]!)) index++;
      const conversion = chars[index];
      if (conversion === undefined) throw new PythonFormatError("ValueError", "incomplete format");
      const value = take();
      let text: string, sign = "", prefix = "", numeric = false;
      if ("sra".includes(conversion)) {
        const representation = pythonText(profile, value, conversion !== "s", conversion === "a", host);
        text = "";
        try {
          for (let count = 0; precision === undefined || count < precision; count++) {
            host.tick(); const next = representation.next();
            if (next.done) break;
            text += next.value;
            if (text.length > limit) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
          }
        } finally { representation.return(undefined); }
      } else if (conversion === "c") {
        if (typeof value === "boolean") text = String.fromCodePoint(Number(value));
        else if (typeof value === "string" && Array.from(value).length === 1) text = value;
        else throw new PythonFormatError("TypeError", "%c requires int or char");
      } else if ("diuoxXeEfFgG".includes(conversion)) {
        if (typeof value !== "number" && typeof value !== "boolean" || "oxX".includes(conversion) && typeof value !== "boolean")
          throw new PythonFormatError("TypeError", "numeric conversion requires a number");
        const number = Number(value), negative = number < 0 || Object.is(number, -0);
        numeric = true;
        sign = negative ? "-" : plus ? "+" : space ? " " : "";
        if ("diuoxX".includes(conversion)) {
          // int(-0.0) and int(-0.5) are zero, with no negative sign.
          const integer = BigInt(Math.trunc(number));
          if (integer === 0n && negative) sign = plus ? "+" : space ? " " : "";
          text = (integer < 0n ? -integer : integer).toString(conversion === "o" ? 8 : "xX".includes(conversion) ? 16 : 10);
          if (precision !== undefined) text = text.padStart(precision, "0");
          if (alternate && "oxX".includes(conversion)) prefix = conversion === "o" ? "0o" : "0x";
        } else text = decimalFloat(Math.abs(number), conversion.toLowerCase(), precision ?? 6, alternate, host);
        if ("XEFG".includes(conversion)) { text = text.toUpperCase(); prefix = prefix.toUpperCase(); }
      } else {
        const code = conversion.codePointAt(0)!;
        throw new PythonFormatError("ValueError", `unsupported format character '${code >= 32 && code <= 126 ? conversion : "?"}' (0x${code.toString(16)}) at index ${index}`);
      }
      let length = 0;
      for (const ignoredChar of text) { host.tick(); length++; }
      const padding = Math.max(0, width - length - sign.length - prefix.length);
      if (left) append(sign + prefix + text + " ".repeat(padding));
      else if (zero && numeric) append(sign + prefix + "0".repeat(padding) + text);
      else append(" ".repeat(padding) + sign + prefix + text);
    }
    if (used !== values.length - 1) throw new PythonFormatError("TypeError", "not all arguments converted during string formatting");
    return boundedText(result.split("\0", 1)[0]!, host);
  } catch (error) {
    if (!(error instanceof PythonFormatError)) throw error;
    return { kind: "error", value: error.type === "TypeError" ? "Python exception (<class 'Gnumeric.GnumericError'>: #VALUE!)" : `Python exception (<class '${error.type}'>: ${error.message})` };
  }
}
