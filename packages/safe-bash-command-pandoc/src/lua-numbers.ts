import {PandocError} from "./errors.js";
import type {LuaInteger, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const space = (byte: number): boolean => byte === 32 || byte >= 9 && byte <= 13;
const digit = (byte: number): number => byte >= 48 && byte <= 57 ? byte - 48
  : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;

/** Lua numeric coercion without retaining a payload-sized JavaScript string.
 * Decimal rounding retains 1100 digits and a sticky digit, sufficient to
 * distinguish every binary64 midpoint. Hexadecimal floats preserve Fengari's
 * thirty-digit accumulator and integers preserve its signed 32-bit wrapping. */
export class LuaNumbers {
  constructor(private readonly heap: LuaStorage) {}
  async coerce(value: StoredLuaValue): Promise<number> {
    const parsed = await this.parse(value);
    return typeof parsed === "number" ? parsed : parsed.value;
  }
  async parse(value: StoredLuaValue): Promise<number | LuaInteger> {
    if (typeof value === "number") return value;
    if (typeof value === "object" && value.kind === "integer") return value;
    const invalid = (): never => {throw new PandocError("E_AST", "convert", "Expected Lua number");};
    if (typeof value !== "object" || value.kind !== "string") return invalid();
    let phase: "start" | "sign" | "zero" | "mantissa" | "exponent" | "exponent-sign" | "exponent-digits" | "end" = "start";
    let negative = false, hex = false, dot = false, digits = 0, fraction = 0, significant = 0;
    let exponent = 0, exponentNegative = false, hasExponent = false;
    let prefix = "", sticky = false, hexFloat = 0, hexInteger = 0, decimalInteger = 0;
    for await (const bytes of this.heap.bytes(value)) for (const byte of bytes) {
      if (phase === "start") {
        if (space(byte)) continue;
        phase = "sign";
        if (byte === 43 || byte === 45) {negative = byte === 45; continue;}
      }
      if (phase === "sign") {
        phase = "mantissa";
        if (byte === 48) {phase = "zero"; digits = 1; continue;}
      } else if (phase === "zero") {
        phase = "mantissa";
        if (byte === 120 || byte === 88) {hex = true; digits = 0; continue;}
      }
      if (phase === "end") {if (!space(byte)) return invalid(); continue;}
      if (phase === "exponent") {
        phase = "exponent-sign";
        if (byte === 43 || byte === 45) {exponentNegative = byte === 45; continue;}
      }
      if (phase === "exponent-sign" || phase === "exponent-digits") {
        const n = digit(byte);
        if (n >= 0 && n < 10) {
          exponent = Math.min(Number.MAX_SAFE_INTEGER, exponent * 10 + n);
          phase = "exponent-digits"; continue;
        }
        if (phase === "exponent-digits" && space(byte)) {phase = "end"; continue;}
        return invalid();
      }
      if (byte === 46 && !dot) {dot = true; continue;}
      if (hex ? byte === 112 || byte === 80 : byte === 101 || byte === 69) {
        if (!digits) return invalid();
        hasExponent = true; phase = "exponent"; continue;
      }
      const n = digit(byte);
      if (n >= 0 && n < (hex ? 16 : 10)) {
        digits++;
        if (dot) fraction++;
        if (hex) hexInteger = (hexInteger * 16 + n) | 0;
        else decimalInteger = Math.min(2147483649, decimalInteger * 10 + n);
        if (n || significant) {
          significant++;
          if (hex) {if (significant <= 30) hexFloat = hexFloat * 16 + n;}
          else if (prefix.length < 1100) prefix += String(n);
          else if (n) sticky = true;
        }
        continue;
      }
      if (space(byte) && digits) {phase = "end"; continue;}
      return invalid();
    }
    if (!digits || phase === "exponent" || phase === "exponent-sign") return invalid();
    if (!dot && !hasExponent) {
      if (hex) return {kind: "integer", value: (negative ? -hexInteger : hexInteger) | 0};
      if (decimalInteger <= 2147483647 + Number(negative)) return {kind: "integer", value: (negative ? -decimalInteger : decimalInteger) | 0};
    }
    if (exponentNegative) exponent = -exponent;
    if (hex) {
      const scale = exponent + 4 * (Math.max(0, significant - 30) - fraction);
      let result = negative ? -hexFloat : hexFloat;
      // Match the existing runtime's staged ldexp rounding.
      const steps = Math.min(3, Math.ceil(Math.abs(scale) / 1023));
      for (let i = 0; i < steps; i++) result *= 2 ** Math.floor((scale + i) / steps);
      return result;
    }
    const coefficient = prefix + (sticky ? "1" : "");
    return prefix ? Number(`${negative ? "-" : ""}${coefficient}e${exponent - fraction + significant - coefficient.length}`) : negative ? -0 : 0;
  }
}
