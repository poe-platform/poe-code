import type { SandboxObject } from "./values.js";

const NativeDisplayNames = Intl.DisplayNames;
const resolvedOptions = NativeDisplayNames.prototype.resolvedOptions;
const of = NativeDisplayNames.prototype.of;
export type ResolvedDisplayNamesOptions = {
  locale: string;
  style: "long" | "short" | "narrow";
  type: "language" | "region" | "script" | "currency" | "calendar" | "dateTimeField";
  fallback: "code" | "none";
  languageDisplay?: "dialect" | "standard";
};
const states = new WeakMap<object, { native: Intl.DisplayNames; options: ResolvedDisplayNamesOptions }>();

export function createSandboxDisplayNames(locales: string | string[], options: Intl.DisplayNamesOptions): SandboxObject {
  const native = new NativeDisplayNames(locales, options);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: Reflect.apply(resolvedOptions, native, []) });
  return value;
}

export function isSandboxDisplayNames(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function displayNamesState(value: unknown) {
  if (!isSandboxDisplayNames(value)) throw new TypeError("Intl.DisplayNames requires a DisplayNames receiver.");
  return states.get(value)!;
}

export function displayName(value: unknown, code: string): string | undefined {
  return Reflect.apply(of, displayNamesState(value).native, [code]);
}
