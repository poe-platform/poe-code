import { numberFormatIntl } from "./numberformat-pluralrules.js";
import type { SandboxObject } from "./values.js";

const PortablePluralRules = numberFormatIntl.PluralRules;
const select = PortablePluralRules.prototype.select;
const selectRange = PortablePluralRules.prototype.selectRange;
const resolvedOptions = PortablePluralRules.prototype.resolvedOptions;
export type ResolvedPluralRulesOptions = Record<string, string | number | string[]>;
const states = new WeakMap<object, { native: object; options: ResolvedPluralRulesOptions }>();

export function createSandboxPluralRules(locales: string | string[], options: Record<string, string | number | boolean | string[]>): SandboxObject {
  const native = new PortablePluralRules(locales, options);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: { ...Reflect.apply(resolvedOptions, native, []) } });
  return value;
}

export function isSandboxPluralRules(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function pluralRulesState(value: unknown) {
  if (!isSandboxPluralRules(value)) throw new TypeError("Intl.PluralRules requires a PluralRules receiver.");
  return states.get(value)!;
}

export function selectPlural(value: unknown, inputs: Array<string | number | bigint>): string {
  inputs = inputs.map(input => {
    if (typeof input !== "string") return input;
    const number = Number(input);
    // Validate JS numeric syntax and clamp overflow/underflow before decimal
    // expansion, retaining the exact text of finite nonzero mathematical values.
    return !Number.isFinite(number) || number === 0 ? number : input.trim();
  });
  return Reflect.apply(inputs.length === 1 ? select : selectRange, pluralRulesState(value).native, inputs);
}
