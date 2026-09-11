import type { SandboxObject } from "./values.js";

const NativeListFormat = Intl.ListFormat;
const resolvedOptions = NativeListFormat.prototype.resolvedOptions;
const format = NativeListFormat.prototype.format;
const formatToParts = NativeListFormat.prototype.formatToParts;
export type ResolvedListFormatOptions = {
  locale: string;
  type: "conjunction" | "disjunction" | "unit";
  style: "long" | "short" | "narrow";
};
const states = new WeakMap<object, { native: Intl.ListFormat; options: ResolvedListFormatOptions }>();

export function createSandboxListFormat(locales: string | string[], options: Intl.ListFormatOptions): SandboxObject {
  const native = new NativeListFormat(locales, options);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: Reflect.apply(resolvedOptions, native, []) });
  return value;
}

export function isSandboxListFormat(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function listFormatState(value: unknown) {
  if (!isSandboxListFormat(value)) throw new TypeError("Intl.ListFormat requires a ListFormat receiver.");
  return states.get(value)!;
}

export function formatList(value: unknown, strings: string[], parts: boolean): string | Array<{ type: string; value: string }> {
  return Reflect.apply(parts ? formatToParts : format, listFormatState(value).native, [strings]);
}
