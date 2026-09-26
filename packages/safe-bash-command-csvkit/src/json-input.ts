import type { Runtime } from "./runtime.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "./errors.js";

export interface JsonNumber { readonly token: string }
export type JsonInput = null | boolean | string | JsonNumber | JsonInput[] | Map<string, JsonInput>;

/** Decode into ordered maps and lexical numbers; never round through binary64. */
export function decodeJson(text: string, runtime: Runtime): JsonInput {
  if (text.startsWith('\uFEFF')) throw new CsvkitDiagnostic('JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)');
  let position = 0;
  const error = (message: string, at = position): never => {
    const prefix = Array.from(text.slice(0, at));
    const line = prefix.filter(char => char === "\n").length + 1;
    const last = prefix.lastIndexOf("\n");
    throw new CsvkitDiagnostic(`JSONDecodeError: ${message}: line ${line} column ${prefix.length - last} (char ${prefix.length})`);
  };
  const white = (): void => { while ([" ", "\t", "\r", "\n"].includes(text[position] ?? "!")) { runtime.step(); position++; } };
  const digit = (): boolean => text[position] !== undefined && text[position]! >= "0" && text[position]! <= "9";
  const string = (): string => {
    const start = position++;
    let characters = 0;
    let precedingHighSurrogate = false;
    while (position < text.length) {
      runtime.step();
      const char = text[position++]!;
      if (char === '"') {
        // The token slice and decoded result are each bounded by the raw token.
        runtime.retain(32 + (position - start) * 4);
        const result = JSON.parse(text.slice(start, position)) as string;
        for (const decoded of result) {
          runtime.step();
          const point = decoded.codePointAt(0)!;
          if (point >= 0xd800 && point <= 0xdfff) throw new CsvkitBlocked("JSON unpaired surrogate output encoding profile");
        }
        return result;
      }
      if (char.charCodeAt(0) < 32) error("Invalid control character at", position - 1);
      let unit = char.charCodeAt(0);
      if (char === "\\") {
        const escaped = text[position++];
        if (escaped === undefined) return error("Unterminated string starting at", start);
        if (escaped === "u") {
          let unicode = 0;
          for (let count = 0; count < 4; count++) {
            const hex = text[position++];
            if (!hex || !"0123456789abcdefABCDEF".includes(hex)) error("Invalid \\uXXXX escape", position - count - 2);
            unicode = unicode * 16 + Number.parseInt(hex!, 16);
          }
          unit = unicode;
        } else {
          if (!'"\\/bfnrt'.includes(escaped)) error("Invalid \\escape", position - 2);
          unit = 0; // Every short escape decodes to one non-surrogate codepoint.
        }
      }
      if (!(precedingHighSurrogate && unit >= 0xdc00 && unit <= 0xdfff)) characters++;
      precedingHighSurrogate = unit >= 0xd800 && unit <= 0xdbff;
      if (characters > runtime.context.limits.maxFieldCharacters) throw new CsvkitBlocked("JSON string field budget exceeded");
    }
    return error("Unterminated string starting at", start);
  };
  const value = (depth: number): JsonInput => {
    runtime.step(); white();
    const char = text[position];
    if (char === '"') return string();
    if (char === "[" || char === "{") {
      if (depth > runtime.context.limits.maxNestingDepth) throw new CsvkitBlocked("JSON nesting budget exceeded");
      const object = char === "{";
      const close = object ? "}" : "]";
      const map = new Map<string, JsonInput>();
      const array: JsonInput[] = [];
      runtime.retain(64); position++; white();
      if (text[position] === close) { position++; return object ? map : array; }
      while (true) {
        runtime.step(); white();
        let key: string | undefined;
        if (object) {
          if (text[position] !== '"') error("Expecting property name enclosed in double quotes");
          key = string(); white();
          if (text[position++] !== ":") error("Expecting ':' delimiter", position - 1);
        }
        const child = value(depth + 1); runtime.retain(48);
        if (object) map.set(key!, child); else array.push(child);
        white();
        if (text[position] === close) { position++; return object ? map : array; }
        if (text[position++] !== ",") error("Expecting ',' delimiter", position - 1);
        const comma = position - 1;
        white();
        if (text[position] === close) error(`Illegal trailing comma before end of ${object ? "object" : "array"}`, comma);
      }
    }
    for (const [word, literal] of [["null", null], ["true", true], ["false", false]] as const) {
      if (text.startsWith(word, position)) { position += word.length; return literal; }
    }
    for (const word of ["NaN", "Infinity", "-Infinity"]) {
      if (text.startsWith(word, position)) { position += word.length; runtime.retain(32 + word.length * 2); return { token: word }; }
    }
    const start = position;
    if (char === "-") position++;
    if (!digit()) return error("Expecting value", start);
    if (text[position] === "0") position++;
    else while (digit()) { runtime.step(); position++; }
    if (text[position] === "." && text[position + 1] !== undefined && text[position + 1]! >= "0" && text[position + 1]! <= "9") {
      position++; while (digit()) { runtime.step(); position++; }
    }
    if (text[position] === "e" || text[position] === "E") {
      const exponentStart = position++;
      if (text[position] === "+" || text[position] === "-") position++;
      if (!digit()) position = exponentStart;
      else while (digit()) { runtime.step(); position++; }
    }
    const token = text.slice(start, position);
    if (token.length > runtime.context.limits.maxDecimalDigits) throw new CsvkitBlocked("JSON number digit budget exceeded");
    if (!token.includes(".") && !token.toLowerCase().includes("e")) {
      const digits = token.length - (token.startsWith("-") ? 1 : 0);
      if (digits > 4300) throw new CsvkitDiagnostic(`ValueError: Exceeds the limit (4300 digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`);
    }
    runtime.retain(32 + token.length * 2);
    return { token };
  };
  const result = value(0); white();
  if (position !== text.length) error("Extra data");
  return result;
}

/** CPython integer and Decimal string spelling for no-inference Agate Text. */
export function jsonNumberText(number: JsonNumber, runtime: Runtime): string {
  const token = number.token;
  if (token === "NaN") return "nan";
  if (token === "Infinity") return "inf";
  if (token === "-Infinity") return "-inf";
  if (!token.includes(".") && !token.toLowerCase().includes("e")) return BigInt(token).toString();
  const negative = token.startsWith("-");
  const [mantissa, exponent = "0"] = token.slice(negative ? 1 : 0).toLowerCase().split("e");
  const [integer, fraction = ""] = mantissa!.split(".");
  const explicit = BigInt(exponent);
  if (Number.isFinite(runtime.context.limits.maxDecimalExponent) && (explicit > BigInt(runtime.context.limits.maxDecimalExponent) || explicit < -BigInt(runtime.context.limits.maxDecimalExponent))) throw new CsvkitBlocked("JSON decimal exponent budget exceeded");
  let digits = integer! + fraction;
  let first = 0;
  while (first < digits.length - 1 && digits[first] === "0") { runtime.step(); first++; }
  digits = digits.slice(first);
  const scale = Number(explicit) - fraction.length;
  const adjusted = scale + digits.length - 1;
  const sign = negative ? "-" : "";
  if (scale > 0 || adjusted < -6) return sign + digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "E" + (adjusted >= 0 ? "+" : "") + adjusted;
  if (scale === 0) return sign + digits;
  const point = digits.length + scale;
  if (point > 0) return sign + digits.slice(0, point) + "." + digits.slice(point);
  runtime.retain((-point + 2) * 2);
  return sign + "0." + "0".repeat(-point) + digits;
}
