import type { SandboxObject } from "./values.js";

const timeFieldLimits = { hour:24, minute:60, second:60, millisecond:1000, microsecond:1000, nanosecond:1000 } as const;
export const temporalPlainTimeFieldNames = Object.freeze(Object.keys(timeFieldLimits) as Array<keyof typeof timeFieldLimits>);
export type TemporalPlainTimeFields = Readonly<Record<keyof typeof timeFieldLimits, number>>;
declare const temporalPlainTimeBrand: unique symbol;
export type SandboxTemporalPlainTime = SandboxObject & { readonly [temporalPlainTimeBrand]: true };
const times = new WeakMap<object, TemporalPlainTimeFields>();

// This internal allocator accepts already converted fields. Guest constructors
// and from()/with() adapters must apply their own coercion/overflow semantics.
export function createSandboxTemporalPlainTime(input: Partial<TemporalPlainTimeFields> = {}): SandboxTemporalPlainTime {
  const fields = Object.create(null) as Record<keyof typeof timeFieldLimits, number>;
  for (const name of temporalPlainTimeFieldNames) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor !== undefined && !("value" in descriptor))
      throw new TypeError("PlainTime fields must be numeric data properties.");
    const value: unknown = descriptor === undefined ? 0 : descriptor.value;
    if (typeof value !== "number") throw new TypeError("PlainTime fields must be numbers.");
    if (!Number.isInteger(value) || value < 0 || value >= timeFieldLimits[name])
      throw new RangeError(`PlainTime ${name} is outside its range.`);
    fields[name] = value === 0 ? 0 : value;
  }
  const result: SandboxTemporalPlainTime = Object.create(null);
  times.set(result, Object.freeze(fields));
  return result;
}

export function isSandboxTemporalPlainTime(value: unknown): value is SandboxTemporalPlainTime {
  return typeof value === "object" && value !== null && times.has(value);
}

export function temporalPlainTimeFields(value: unknown): TemporalPlainTimeFields {
  if (!isSandboxTemporalPlainTime(value)) throw new TypeError("Expected a Temporal PlainTime receiver.");
  return times.get(value)!;
}
