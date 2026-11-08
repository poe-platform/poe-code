import { WkhtmltopdfError } from "./errors.js";
import type { Length } from "./settings.js";

export function integer(text: string, min: number, max: number): number {
  const value = text.trim();
  let index = value[0] === "+" || value[0] === "-" ? 1 : 0;
  if (index === value.length) throw new WkhtmltopdfError("INVALID_VALUE", "Expected an integer");
  for (; index < value.length; index++) {
    if (value[index]! < "0" || value[index]! > "9") {
      throw new WkhtmltopdfError("INVALID_VALUE", "Expected a decimal integer");
    }
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Integer is outside the admitted range");
  }
  return result;
}

export function float32(text: string, positive: boolean): number {
  const value = text.trim();
  let digits = 0;
  for (const character of value) {
    if (character >= "0" && character <= "9") digits++;
    else if (!"+-.eE".includes(character)) {
      throw new WkhtmltopdfError("INVALID_VALUE", "Expected a decimal float");
    }
  }
  const result = Math.fround(Number(value));
  if (!digits || !Number.isFinite(result) || (positive ? result <= 0 : result < 0)) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Float is outside the admitted finite binary32 range");
  }
  return result;
}

export function choice(text: string, values: readonly string[]): string {
  const result = values.find(value => value.toLowerCase() === text.toLowerCase());
  if (result === undefined) throw new WkhtmltopdfError("INVALID_VALUE", "Unknown enumerated value");
  return result;
}

export function length(text: string): Length {
  let index = 0;
  while (text[index] !== undefined && text[index]! >= "0" && text[index]! <= "9") index++;
  if (text[index] === ".") index++;
  while (text[index] !== undefined && text[index]! >= "0" && text[index]! <= "9") index++;
  const number = text.slice(0, index);
  const value = Number(number);
  if (!number || number === "." || !Number.isFinite(value)) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Expected an unsigned finite length");
  }
  const units: Readonly<Record<string, readonly [Length["unit"], number]>> = {
    "": ["mm", 1], mm: ["mm", 1], millimeter: ["mm", 1],
    cm: ["mm", 10], centimeter: ["mm", 10], m: ["mm", 1000], meter: ["mm", 1000],
    in: ["in", 1], inch: ["in", 1], pt: ["pt", 1], point: ["pt", 1],
    px: ["px", 1], pixel: ["px", 1], pc: ["pc", 1], pica: ["pc", 1],
    didot: ["didot", 1], cicero: ["cicero", 1],
  };
  const suffix = text.slice(index).toLowerCase();
  const entry = Object.hasOwn(units, suffix) ? units[suffix] : undefined;
  if (!entry || !Number.isFinite(value * entry[1])) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Unknown or overflowing length unit");
  }
  return { value: value * entry[1], unit: entry[0] };
}
