import type { SandboxObject } from "./values.js";

const NativeRelativeTimeFormat = Intl.RelativeTimeFormat;
const resolvedOptions = NativeRelativeTimeFormat.prototype.resolvedOptions;
const format = NativeRelativeTimeFormat.prototype.format;
const formatToParts = NativeRelativeTimeFormat.prototype.formatToParts;
export type ResolvedRelativeTimeFormatOptions = {
  locale: string;
  numberingSystem: string;
  style: "long" | "short" | "narrow";
  numeric: "always" | "auto";
};
const states = new WeakMap<object, { native: Intl.RelativeTimeFormat; options: ResolvedRelativeTimeFormatOptions }>();

export function createSandboxRelativeTimeFormat(locales: string | string[], options: Intl.RelativeTimeFormatOptions): SandboxObject {
  const native = new NativeRelativeTimeFormat(locales, options);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: Reflect.apply(resolvedOptions, native, []) });
  return value;
}

export function isSandboxRelativeTimeFormat(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function relativeTimeFormatState(value: unknown) {
  if (!isSandboxRelativeTimeFormat(value)) throw new TypeError("Intl.RelativeTimeFormat requires a RelativeTimeFormat receiver.");
  return states.get(value)!;
}

export function formatRelativeTime(value: unknown, amount: number, unit: string, parts: boolean): string | Array<{ type: string; value: string; unit?: string }> {
  return Reflect.apply(parts ? formatToParts : format, relativeTimeFormatState(value).native, [amount, unit]);
}
