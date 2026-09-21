import type { CellValue } from "../../workbook.js";
import { error, numericResult } from "../values.js";
import { numberArg, scalarArg, str } from "./common.js";
import { fakeTrunc } from "./floating-point.js";
import { matchNumber } from "./text.js";
import type { FunctionHost, FunctionImplementation } from "./types.js";

interface Conversion {
  readonly source: number;
  readonly destination: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly numeric?: boolean;
  readonly generalString?: boolean;
}
const conversions: Readonly<Record<string, Conversion>> = {
  BIN2DEC: { source: 2, destination: 10, minimum: 0, maximum: 1111111111, numeric: true },
  BIN2HEX: { source: 2, destination: 16, minimum: 0, maximum: 1111111111 },
  BIN2OCT: { source: 2, destination: 8, minimum: 0, maximum: 1111111111 },
  OCT2DEC: { source: 8, destination: 10, minimum: 0, maximum: 7777777777, numeric: true },
  OCT2BIN: { source: 8, destination: 2, minimum: 0, maximum: 7777777777 },
  OCT2HEX: { source: 8, destination: 16, minimum: 0, maximum: 7777777777 },
  HEX2DEC: { source: 16, destination: 10, minimum: 0, maximum: 2 ** 40 - 1, numeric: true },
  HEX2BIN: { source: 16, destination: 2, minimum: 0, maximum: 9999999999 },
  HEX2OCT: { source: 16, destination: 8, minimum: 0, maximum: 9999999999 },
  DEC2BIN: { source: 10, destination: 2, minimum: -512, maximum: 511 },
  DEC2OCT: { source: 10, destination: 8, minimum: -(2 ** 29), maximum: 2 ** 29 - 1 },
  DEC2HEX: { source: 10, destination: 16, minimum: -(2 ** 39), maximum: 2 ** 39 - 1 }
};
function parseDigits(text: string, base: number): number | undefined {
  let result = 0n;
  // g_ascii_strtoll accepts the hexadecimal prefix even without V2B_STRINGS_0XH.
  if (base === 16 && text.slice(0, 2).toLowerCase() === "0x") text = text.slice(2);
  if (!text.length) return undefined;
  for (const char of text.toUpperCase()) {
    const digit = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(char);
    if (digit < 0 || digit >= base) return undefined;
    result = result * BigInt(base) + BigInt(digit);
    if (result > 9223372036854775807n) return Number(9223372036854775807n);
  }
  return Number(result);
}
/** Released val_to_base: numeric inputs are decimal digits, strings use source radix. */
function convert(value: CellValue, places: CellValue | undefined, config: Conversion, host: FunctionHost): CellValue {
  if (value.kind === "error") return value;
  if (places?.kind === "error") return places;
  if (value.kind === "boolean" || places?.kind === "boolean") return error("#VALUE!");
  let x: number | undefined;
  if (config.generalString) {
    const matched = value.kind === "string" ? matchNumber(value.value, host) : value.kind === "number" ? value.value : undefined;
    x = typeof matched === "number" ? matched : undefined;
    if (x === undefined) return error(value.kind === "string" ? "#VALUE!" : "#NUM!");
    x = fakeTrunc(Number(x));
  } else if (value.kind === "string") {
    const text = value.value || "0";
    if (text.length > 10) return error("#NUM!");
    x = parseDigits(text, config.source);
  } else if (value.kind === "number") {
    const integer = fakeTrunc(value.value);
    if (integer < config.minimum || integer > config.maximum) return error("#NUM!");
    x = parseDigits(integer.toFixed(0), config.source);
  }
  if (x === undefined || x < config.minimum || x > config.maximum) return error("#NUM!");
  if (config.source !== 10 && x >= config.source ** 10 / 2) x -= config.source ** 10;
  if (config.numeric) return numericResult(x);
  const negative = x < 0;
  if (negative) x += config.destination ** 10;
  // The captured ARM64 native profile saturates negative float-to-guint64 casts.
  let output = BigInt(Math.max(0, Math.trunc(x + .5))).toString(config.destination).toUpperCase();
  // Upstream emits exactly ten low digits for a negative value.
  if (negative) output = output.slice(-10).padStart(10, "0");
  const minimum = negative ? 1 : output.length;
  if (places) {
    const count = places.kind === "number" ? places.value : 0;
    if (count < minimum || count > 10) return error("#NUM!");
    output = output.padStart(Math.trunc(count), "0");
  }
  return str(output);
}
export const engineeringFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(Object.entries(conversions).map(([name, config]) => [name, ((args, host) =>
    convert(scalarArg(args, 0, host), args[1] === undefined ? undefined : host.scalar(args[1]),
      { ...config, generalString: config.source === 10 }, host)) satisfies FunctionImplementation])),
  BASE: (args, host) => {
    const base = numberArg(args, 1, host);
    if (base < 2 || base >= 37) return error("#NUM!");
    return convert(scalarArg(args, 0, host), args[2] === undefined ? undefined : host.scalar(args[2]),
      { source: 10, destination: Math.trunc(base), minimum: -(2 ** 52), maximum: 2 ** 52, generalString: true }, host);
  },
  DECIMAL: (args, host) => {
    const base = numberArg(args, 1, host);
    if (base < 2 || base >= 37) return error("#NUM!");
    return convert(scalarArg(args, 0, host), undefined,
      { source: Math.trunc(base), destination: 10, minimum: 0, maximum: 2 ** 40 - 1, numeric: true }, host);
  },
  DELTA: (args, host) => numericResult(Number(numberArg(args, 0, host) === numberArg(args, 1, host))),
  GESTEP: (args, host) => numericResult(Number(numberArg(args, 0, host) >= numberArg(args, 1, host)))
};
