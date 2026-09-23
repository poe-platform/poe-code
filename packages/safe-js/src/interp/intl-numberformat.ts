import { SandboxError, type Budget } from "./budget.js";
import { createNumberFormatter, numberFormatterOptions, numberFormatterResult } from "./numberformat-backend.js";
import { objectToPrimitive } from "./string-coercion.js";
import type { SandboxCallContext, SandboxClosure, SandboxObject, SandboxValue } from "./values.js";

export type NumberFormatOptions = Record<string, string | number | boolean>;
const states = new WeakMap<object, { native: ReturnType<typeof createNumberFormatter>; options: NumberFormatOptions; format?: SandboxClosure }>();

export function createSandboxNumberFormat(locales: string | string[], options: NumberFormatOptions): SandboxObject {
  const native = createNumberFormatter(locales, options);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: numberFormatterOptions(native) });
  return value;
}

export function isSandboxNumberFormat(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function numberFormatState(value: unknown) {
  if (!isSandboxNumberFormat(value)) throw new TypeError("Intl.NumberFormat requires a NumberFormat receiver.");
  return states.get(value)!;
}

export async function numberFormatValue(value: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<number | bigint | string> {
  const primitive = typeof value === "object" && value !== null
    ? await objectToPrimitive(value, budget, context, new Set(), "number") : value;
  if (typeof primitive === "string" || typeof primitive === "bigint") {
    budget.visitNode(typeof primitive === "string" ? primitive.length : primitive.toString(16).length * 4);
    return primitive;
  }
  return Number(primitive);
}

// Keep a single synchronous formatter call well below a 128 MiB isolate's
// envelope, including transient native parts, strings and their guest copies.
const MAX_FORMAT_ALLOCATION = 16 * 1024 * 1024;

export function formatNumberValue(receiver: unknown, method: "format" | "formatToParts" | "formatRange" | "formatRangeToParts", values: Array<number | bigint | string>, budget: Budget): SandboxValue {
  const { native, options } = numberFormatState(receiver);
  // Hex conversion is linear and avoids the expensive decimal conversion we
  // are admitting. Two decimal digits per hex digit is a safe upper bound.
  const magnitudes = values.map(value => typeof value === "bigint" ? value.toString(16).length * 2
    : typeof value === "string" ? value.length : 309);
  if (magnitudes.some(digits => digits > 128) && values.some(value => typeof value !== "number")) {
    let parts = 0;
    let characters = 0;
    for (const digits of magnitudes) {
      // Percent scaling, rounding carry, padding and fraction digits. Scientific
      // and engineering notation retain only a bounded significand and exponent.
      const displayed = options.notation === "scientific" || options.notation === "engineering"
        ? 512 : digits + 128;
      const endpointParts = options.useGrouping === false ? 32 : displayed * 2 + 32;
      parts += endpointParts;
      characters += displayed * 4 + 256;
    }
    // Range separators/approximation signs and localized affixes fit in the
    // endpoint slack. 256 bytes per part covers records, fields and native copies.
    // Even scientific output can require a decimal representation internally.
    const bytes = parts * 256 + characters * 2 + magnitudes.reduce((sum, digits) => sum + digits * 16, 0);
    if (method.endsWith("ToParts")) budget.allocateArrayLength(parts);
    const totalBytes = budget.currentDataSize + bytes;
    if (totalBytes > MAX_FORMAT_ALLOCATION) throw new SandboxError({ budget: "dataSize", current: totalBytes, limit: MAX_FORMAT_ALLOCATION });
    const reservation = {};
    budget.setRetainedDataUsage(reservation, bytes);
    try { return numberFormatterResult(native, method, values); }
    finally { budget.setRetainedDataUsage(reservation, 0); }
  }
  return numberFormatterResult(native, method, values);
}
