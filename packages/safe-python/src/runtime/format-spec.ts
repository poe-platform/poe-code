import { unicodeDecimal } from "./unicode-decimal.js";
import type { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface FormatSpec {
  readonly fill: number;
  readonly align: "<" | ">" | "=" | "^";
  readonly sign: "+" | "-" | " " | null;
  readonly noNegativeZero: boolean;
  readonly alternate: boolean;
  readonly width: bigint | null;
  readonly grouping: "," | "_" | null;
  readonly groupSize: 3 | 4;
  readonly precision: bigint | null;
  readonly fractionGrouping: "," | "_" | null;
  readonly type: number;
}

/** Shared Python 3.14 format syntax, not a type-specific formatter. Digits are
 * Unicode decimal values, fill/type remain code points, and numeric fields are
 * bounded to signed 64-bit platform size. No guest protocols run while parsing. */
export function parseFormatSpec(source: CodePointString, defaultType: number, defaultAlign: "<" | ">", typeName: string, meter: ExecutionMeter): FormatSpec {
  meter.checkpoint(1, 768);
  let position = 0;
  const read = (offset = 0): number => {
    meter.checkpoint(1, 8);
    return position + offset < source.length ? source.codePointAt(BigInt(position + offset), meter) : -1;
  };
  const integer = (): bigint | null => {
    let result: bigint | null = null;
    for (;;) {
      const digit = unicodeDecimal(read(), meter);
      if (digit < 0) return result;
      meter.checkpoint(1, 64);
      const next: bigint = (result ?? 0n) * 10n + BigInt(digit);
      if (next > 9223372036854775807n) throw new PythonRuntimeError("ValueError", "Too many decimal digits in format string");
      result = next; position++;
    }
  };
  const grouping = (): "," | "_" | null => {
    const point = read();
    if (point !== 44 && point !== 95) return null;
    position++;
    if (read() === (point === 44 ? 95 : 44)) throw new PythonRuntimeError("ValueError", "Cannot specify both ',' and '_'.");
    return point === 44 ? "," : "_";
  };
  let fill = 32, align: FormatSpec["align"] = defaultAlign, explicitFill = false, explicitAlign = false;
  if (alignment(read(1))) {
    fill = read(); align = String.fromCharCode(read(1)) as FormatSpec["align"];
    position += 2; explicitFill = explicitAlign = true;
  } else if (alignment(read())) {
    align = String.fromCharCode(read()) as FormatSpec["align"];
    position++; explicitAlign = true;
  }
  let sign: FormatSpec["sign"] = null;
  if (read() === 32 || read() === 43 || read() === 45) { sign = String.fromCharCode(read()) as FormatSpec["sign"]; position++; }
  const noNegativeZero = read() === 122;
  if (noNegativeZero) position++;
  const alternate = read() === 35;
  if (alternate) position++;
  if (!explicitFill && read() === 48) {
    fill = 48; position++;
    if (!explicitAlign && defaultAlign === ">") align = "=";
  }
  const width = integer(), thousands = grouping();
  let precision: bigint | null = null, fractionGrouping: FormatSpec["fractionGrouping"] = null;
  if (read() === 46) {
    position++; precision = integer(); fractionGrouping = grouping();
    if (precision === null && fractionGrouping === null) throw new PythonRuntimeError("ValueError", "Format specifier missing precision");
  }
  if (source.length - position > 1) {
    meter.checkpoint(1, 64 + source.length * 16);
    const characters: string[] = [];
    for (const point of source) { meter.checkpoint(); characters.push(String.fromCodePoint(point)); }
    throw new PythonRuntimeError("ValueError", `Invalid format specifier '${characters.join("")}' for object of type '${diagnosticTypeName(typeName, meter)}'`);
  }
  const type = position < source.length ? read() : defaultType;
  let groupSize: 3 | 4 = 3;
  if (thousands !== null) {
    switch (type) {
      case 0: case 100: case 101: case 102: case 103: case 69: case 70: case 71: case 37: break;
      case 98: case 111: case 120: case 88:
        if (thousands === "_") { groupSize = 4; break; }
        invalidGrouping(thousands, type);
        break;
      default: invalidGrouping(thousands, type);
    }
  }
  if (type === 110 && fractionGrouping !== null) invalidGrouping(fractionGrouping, type);
  meter.checkpoint(0, 128);
  return Object.freeze({ fill, align, sign, noNegativeZero, alternate, width, grouping: thousands, groupSize, precision, fractionGrouping, type });
}

function alignment(point: number): boolean { return point === 60 || point === 62 || point === 61 || point === 94; }

function invalidGrouping(separator: "," | "_", type: number): never {
  const name = type > 32 && type < 128 ? String.fromCharCode(type) : `\\x${type.toString(16)}`;
  throw new PythonRuntimeError("ValueError", `Cannot specify '${separator}' with '${name}'.`);
}
