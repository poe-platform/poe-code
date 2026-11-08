import type { LlmOption } from "./types.js";

function decimalDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

/** Coerce the pinned reference's decimal syntax without accepting radix prefixes. */
export function parseLlmNumericOption(input: LlmOption, type: "number" | "integer"): number | undefined {
  if (typeof input === "number") return type === "integer" && input === 0 ? 0 : input;
  if (typeof input !== "string") return undefined;
  const text = input.trim();
  if (!text) return undefined;
  if (type === "integer") {
    let index = text[0] === "+" || text[0] === "-" ? 1 : 0;
    let digits = 0;
    while (index < text.length) {
      if (decimalDigit(text[index])) { digits++; index++; }
      else if (text[index] === "_" && decimalDigit(text[index - 1]) && decimalDigit(text[index + 1])) index++;
      else break;
    }
    if (!digits) return undefined;
    if (text[index] === ".") {
      const first = ++index;
      while (text[index] === "0") index++;
      if (first === index) return undefined;
    }
    if (index !== text.length) return undefined;
    const value = Number(text.replaceAll("_", ""));
    return value === 0 ? 0 : value;
  }
  if (text.startsWith("_") || text.endsWith("_") || text.includes("__")) return undefined;
  const normalized = text.replaceAll("_", "");
  let index = normalized[0] === "+" || normalized[0] === "-" ? 1 : 0;
  const special = normalized.slice(index).toLowerCase();
  if (special === "nan") return NaN;
  if (special === "inf" || special === "infinity") return normalized[0] === "-" ? -Infinity : Infinity;
  let digits = 0;
  while (decimalDigit(normalized[index])) { digits++; index++; }
  if (normalized[index] === ".") {
    index++;
    while (decimalDigit(normalized[index])) { digits++; index++; }
  }
  if (!digits) return undefined;
  if (normalized[index] === "e" || normalized[index] === "E") {
    index++;
    if (normalized[index] === "+" || normalized[index] === "-") index++;
    const first = index;
    while (decimalDigit(normalized[index])) index++;
    if (first === index) return undefined;
  }
  return index === normalized.length ? Number(normalized) : undefined;
}
