import { expect, it } from "vitest";
import type { Temporal as TemporalTypes } from "temporal-polyfill/full/implementation";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";
import { createSandboxTemporalInstant, temporalInstantEpoch } from "./temporal-instant.js";
import { run } from "../run.js";

const NativeInstant = (Object.getOwnPropertyDescriptor(globalThis,"Temporal")?.value as {Instant?: typeof TemporalTypes.Instant} | undefined)?.Instant;

it.runIf(NativeInstant !== undefined)("imports native host Instants with exact epochs and aliases", () => {
  if (NativeInstant === undefined) throw new Error("Native Temporal required");
  const instant = new NativeInstant(-1n);
  const imported = deepCopyToSandbox([instant,instant]);
  if (!Array.isArray(imported)) throw new Error("Expected array");
  expect(imported[0]).toBe(imported[1]);
  expect(temporalInstantEpoch(imported[0])).toBe(-1n);
});

it.runIf(NativeInstant !== undefined)("exports into the native host Instant class when available", () => {
  if (NativeInstant === undefined) throw new Error("Native Temporal required");
  const exported = deepCopyFromSandbox(createSandboxTemporalInstant(1n));
  expect(exported instanceof NativeInstant).toBe(true);
  expect((exported as InstanceType<typeof NativeInstant>).epochNanoseconds).toBe(1n);
});

it.runIf(NativeInstant !== undefined)("accepts a native Instant as an injected binding", async () => {
  if (NativeInstant === undefined) throw new Error("Native Temporal required");
  expect(await run("return [value instanceof Temporal.Instant,value.toJSON()]",{bindings:{value:new NativeInstant(-1n)}}))
    .toMatchObject({ok:true,returnValue:[true,"1969-12-31T23:59:59.999999999Z"]});
});

it.runIf(NativeInstant !== undefined)("rejects a forged native Instant without reading its own epoch accessor", () => {
  if (NativeInstant === undefined) throw new Error("Native Temporal required");
  let reads=0;
  const forged=Object.create(NativeInstant.prototype);
  Object.defineProperty(forged,"epochNanoseconds",{get(){reads++;return 1n}});
  expect(() => deepCopyToSandbox(forged)).toThrow(TypeError);
  expect(reads).toBe(0);
});
