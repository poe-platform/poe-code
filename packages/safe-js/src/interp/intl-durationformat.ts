import type { readDurationOptions } from "./intl-duration-options.js";
import type { SandboxObject } from "./values.js";

export type DurationSettings = Omit<Awaited<ReturnType<typeof readDurationOptions>>, "fractionalDigits"> & { fractionalDigits?: number };
const states = new WeakMap<object, { settings: DurationSettings; options: Record<string, string | number | undefined> }>();

export function createSandboxDurationFormat(settings: DurationSettings): SandboxObject {
  const value = Object.create(null) as SandboxObject;
  const options: Record<string, string | number | undefined> = { locale: settings.locale, numberingSystem: settings.numberingSystem, style: settings.style };
  for (const [unit, { style, display }] of Object.entries(settings.units)) {
    options[unit] = style === "fractional" ? "numeric" : style;
    options[`${unit}Display`] = display;
  }
  options.fractionalDigits = settings.fractionalDigits;
  states.set(value, { settings, options });
  return value;
}

export function isSandboxDurationFormat(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function durationFormatState(value: unknown) {
  if (!isSandboxDurationFormat(value)) throw new TypeError("Intl.DurationFormat requires a DurationFormat receiver.");
  return states.get(value)!;
}
