import type { Budget } from "./budget.js";
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

export function formatNumberValue(receiver: unknown, method: "format" | "formatToParts" | "formatRange" | "formatRangeToParts", values: Array<number | bigint | string>): SandboxValue {
  const { native } = numberFormatState(receiver);
  return numberFormatterResult(native, method, values);
}
