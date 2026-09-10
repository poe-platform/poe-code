import { expect, it } from "vitest";
import { createSandboxTemporalInstant, isSandboxTemporalInstant, temporalInstantEpoch } from "./temporal-instant.js";
import { measureSandboxData } from "./values.js";

it.each([0n, 1n, -1n, 8640000000000000000000n, -8640000000000000000000n])("retains exact Instant epoch %s privately", epoch => {
  const value=createSandboxTemporalInstant(epoch);
  expect(isSandboxTemporalInstant(value)).toBe(true);
  expect(Reflect.ownKeys(value)).toEqual([]);
  expect(Object.getPrototypeOf(value)).toBeNull();
  Object.freeze(value);
  expect(temporalInstantEpoch(value)).toBe(epoch);
});

it.each([8640000000000000000001n, -8640000000000000000001n])("rejects out-of-range epoch %s", epoch => {
  expect(()=>createSandboxTemporalInstant(epoch)).toThrow(RangeError);
});

it("does not coerce or accept forged receivers", () => {
  let calls=0;
  const value={valueOf(){calls++;return 0n}};
  expect(()=>createSandboxTemporalInstant(value as unknown as bigint)).toThrow(TypeError);
  expect(()=>temporalInstantEpoch(value)).toThrow(TypeError);
  expect(isSandboxTemporalInstant(value)).toBe(false);
  expect(calls).toBe(0);
});

it("accounts for private nanoseconds once per object, preserving ordinary properties", () => {
  const epoch=8640000000000000000000n;
  const value=createSandboxTemporalInstant(epoch);
  expect(measureSandboxData([value])).toBe(1+epoch.toString(16).length);
  expect(measureSandboxData([value,value])).toBe(measureSandboxData([value]));
  value.label="clock";
  expect(measureSandboxData([value])).toBe(1+epoch.toString(16).length+6+5);
});
