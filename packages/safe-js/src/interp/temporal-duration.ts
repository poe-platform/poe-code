import type { SandboxObject } from "./values.js";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { types } from "node:util";

const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativeDuration = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "Duration")?.value as typeof TemporalBackend.Duration | undefined
  : undefined;
const HostDuration = NativeDuration ?? TemporalBackend.Duration;

export const temporalDurationFieldNames = [
  "years", "months", "weeks", "days", "hours", "minutes", "seconds",
  "milliseconds", "microseconds", "nanoseconds"
] as const;
export type TemporalDurationFields = Readonly<Record<typeof temporalDurationFieldNames[number], number>>;
const hostFieldReaders = new Map([TemporalBackend.Duration, HostDuration].map(constructor => [
  constructor.prototype, temporalDurationFieldNames.map(name => Object.getOwnPropertyDescriptor(constructor.prototype, name)!.get!)
]));
const exportedDurations = new WeakSet<object>();

export function createHostTemporalDuration(fields: TemporalDurationFields): object {
  const value = Reflect.construct(HostDuration, temporalDurationFieldNames.map(name => fields[name]));
  exportedDurations.add(value);
  return value;
}

export function hostTemporalDurationFields(value: unknown): TemporalDurationFields | undefined {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  let readers = hostFieldReaders.get(prototype);
  if (readers === undefined) {
    if (!exportedDurations.has(value)) return undefined;
    if (prototype !== null) throw new TypeError("Custom host Duration prototypes cannot be copied as data.");
    readers = hostFieldReaders.get(HostDuration.prototype)!;
  }
  return Object.fromEntries(temporalDurationFieldNames.map((name, index) =>
    [name, Reflect.apply(readers[index]!, value, [])])) as TemporalDurationFields;
}

declare const temporalDurationBrand: unique symbol;
export type SandboxTemporalDuration = SandboxObject & { readonly [temporalDurationBrand]: true };
const durations = new WeakMap<object, TemporalDurationFields>();

export function createSandboxTemporalDuration(input: Partial<TemporalDurationFields> = {}): SandboxTemporalDuration {
  if (input === null || typeof input !== "object" || types.isProxy(input))
    throw new TypeError("Duration fields must be an ordinary data record.");
  const fields = Object.create(null) as Record<typeof temporalDurationFieldNames[number], number>;
  let sign = 0;
  for (const name of temporalDurationFieldNames) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor !== undefined && !("value" in descriptor))
      throw new TypeError("Duration fields must be numeric data properties.");
    const field: unknown = descriptor === undefined ? 0 : descriptor.value;
    if (typeof field !== "number") throw new TypeError("Duration fields must be numbers.");
    if (!Number.isInteger(field)) throw new RangeError("Duration fields must be finite integers.");
    const fieldSign = Math.sign(field);
    if (fieldSign !== 0) {
      if (sign !== 0 && sign !== fieldSign) throw new RangeError("Duration fields must have the same sign.");
      sign = fieldSign;
    }
    fields[name] = field === 0 ? 0 : field;
  }
  for (const name of ["years", "months", "weeks"] as const) {
    if (Math.abs(fields[name]) >= 4294967296)
      throw new RangeError("Duration calendar field is outside the supported range.");
  }
  // IsValidDuration requires exact arithmetic, including subsecond carries.
  const seconds = ((BigInt(fields.days) * 24n + BigInt(fields.hours)) * 60n
    + BigInt(fields.minutes)) * 60n + BigInt(fields.seconds);
  const nanoseconds = ((seconds * 1000n + BigInt(fields.milliseconds)) * 1000n
    + BigInt(fields.microseconds)) * 1000n + BigInt(fields.nanoseconds);
  const limit = 9007199254740992n * 1000000000n;
  if (nanoseconds <= -limit || nanoseconds >= limit)
    throw new RangeError("Duration time fields are outside the supported range.");
  const value: SandboxTemporalDuration = Object.create(null);
  durations.set(value, Object.freeze(fields));
  return value;
}

export function isSandboxTemporalDuration(value: unknown): value is SandboxTemporalDuration {
  return typeof value === "object" && value !== null && durations.has(value);
}

export function temporalDurationFields(value: unknown): TemporalDurationFields {
  if (!isSandboxTemporalDuration(value)) throw new TypeError("Expected a Temporal Duration receiver.");
  return durations.get(value)!;
}
