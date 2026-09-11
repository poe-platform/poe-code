import type { SandboxObject } from "./values.js";
import { types } from "node:util";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";

const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativeInstant = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "Instant")?.value as typeof TemporalBackend.Instant | undefined
  : undefined;
const HostInstant = NativeInstant ?? TemporalBackend.Instant;
const readHostEpoch = Object.getOwnPropertyDescriptor(HostInstant.prototype, "epochNanoseconds")!.get!;
const hostEpochReaders = new Map([TemporalBackend.Instant, HostInstant].map(constructor => [
  constructor.prototype, Object.getOwnPropertyDescriptor(constructor.prototype, "epochNanoseconds")!.get!
]));
const exportedInstants = new WeakSet<object>();

export function createHostTemporalInstant(epoch: bigint): object {
  const value = new HostInstant(epoch);
  exportedInstants.add(value);
  return value;
}

export function hostTemporalInstantEpoch(value: unknown): bigint | undefined {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  const readEpoch = hostEpochReaders.get(prototype);
  if (readEpoch !== undefined) return Reflect.apply(readEpoch, value, []) as bigint;
  if (!exportedInstants.has(value)) return undefined;
  if (prototype !== null) throw new TypeError("Custom host Instant prototypes cannot be copied as data.");
  return Reflect.apply(readHostEpoch, value, []) as bigint;
}

declare const temporalInstantBrand: unique symbol;
export type SandboxTemporalInstant = SandboxObject & { readonly [temporalInstantBrand]: true };
const epochs = new WeakMap<object, bigint>();
const maximumEpochNanoseconds = 8640000000000000000000n;

export function createSandboxTemporalInstant(epochNanoseconds: bigint): SandboxTemporalInstant {
  if (typeof epochNanoseconds !== "bigint") throw new TypeError("Instant epoch must be a BigInt.");
  if (epochNanoseconds < -maximumEpochNanoseconds || epochNanoseconds > maximumEpochNanoseconds)
    throw new RangeError("Instant epoch is outside the supported range.");
  const value: SandboxTemporalInstant = Object.create(null);
  epochs.set(value, epochNanoseconds);
  return value;
}

export function isSandboxTemporalInstant(value: unknown): value is SandboxTemporalInstant {
  return typeof value === "object" && value !== null && epochs.has(value);
}

export function temporalInstantEpoch(value: unknown): bigint {
  if (!isSandboxTemporalInstant(value)) throw new TypeError("Expected a Temporal Instant receiver.");
  return epochs.get(value)!;
}
