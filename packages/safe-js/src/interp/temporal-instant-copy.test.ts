import { expect, it } from "vitest";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { run } from "../run.js";
import { createSandboxTemporalInstant, isSandboxTemporalInstant, temporalInstantEpoch } from "./temporal-instant.js";

it.each([0n, -1n, 8640000000000000000000n])("copies the private Instant epoch %s without losing aliases", epoch => {
  const instant = createSandboxTemporalInstant(epoch);
  Object.defineProperty(instant, "self", { value: instant, enumerable: false });
  Object.freeze(instant);
  const copied = cloneSandboxValue([instant, instant]) as typeof instant[];
  expect(copied[0]).not.toBe(instant);
  expect(copied[0]).toBe(copied[1]);
  expect(isSandboxTemporalInstant(copied[0])).toBe(true);
  expect(temporalInstantEpoch(copied[0])).toBe(epoch);
  expect(Object.getOwnPropertyDescriptor(copied[0], "self")).toEqual({
    value: copied[0], enumerable: false, configurable: false, writable: false
  });
  expect(Object.isFrozen(copied[0])).toBe(true);
});

it("exports an Instant with its exact host-readable epoch and graph state", () => {
  const instant = createSandboxTemporalInstant(-1n);
  Object.defineProperty(instant, "self", { value: instant });
  Object.freeze(instant);
  const exported = deepCopyFromSandbox([instant, instant]) as Array<{epochNanoseconds: bigint; self: unknown; toJSON(): string}>;
  expect(exported[0]).toBe(exported[1]);
  expect(exported[0].epochNanoseconds).toBe(-1n);
  expect(exported[0].self).toBe(exported[0]);
  expect(exported[0].toJSON()).toBe("1969-12-31T23:59:59.999999999Z");
  expect(Object.isFrozen(exported[0])).toBe(true);
});

it("exports an Instant returned through the public run API", async () => {
  const result = await run("return new Temporal.Instant(-1n)");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Instant return failed");
  expect(temporalInstantEpoch(result.returnValue)).toBe(-1n);
  const exported = deepCopyFromSandbox(result.returnValue) as {epochNanoseconds: bigint};
  expect(exported.epochNanoseconds).toBe(-1n);
});

it("preserves an explicitly null prototype on export", async () => {
  const result = await run("return Object.setPrototypeOf(new Temporal.Instant(1n),null)");
  if (!result.ok) throw new Error("Instant creation failed");
  expect(Object.getPrototypeOf(deepCopyFromSandbox(result.returnValue))).toBe(null);
});

it.each([
  "const value=new Temporal.Instant(1n);Object.setPrototypeOf(value,{custom:true});return value",
  "const value=new Temporal.Instant(1n);Temporal.Instant.prototype.custom=true;return value"
])("does not discard a custom or modified guest prototype: %s", async source => {
  const result = await run(source);
  if (!result.ok) throw new Error("Instant creation failed");
  expect(() => deepCopyFromSandbox(result.returnValue)).toThrow("Guest prototype links");
});

it.each([0n, -1n, 8640000000000000000000n])("imports a host Instant at %s without losing graph state", epoch => {
  const instant = new TemporalBackend.Instant(epoch);
  Object.defineProperty(instant, "self", {value: instant});
  Object.freeze(instant);
  const imported = deepCopyToSandbox([instant, instant]) as ReturnType<typeof createSandboxTemporalInstant>[];
  expect(imported[0]).toBe(imported[1]);
  expect(temporalInstantEpoch(imported[0])).toBe(epoch);
  expect(imported[0].self).toBe(imported[0]);
  expect(Object.isFrozen(imported[0])).toBe(true);
});

it("round-trips an exported Instant with a null prototype", async () => {
  const result = await run("return Object.setPrototypeOf(new Temporal.Instant(-1n),null)");
  if (!result.ok) throw new Error("Instant creation failed");
  const imported = deepCopyToSandbox(deepCopyFromSandbox(result.returnValue));
  expect(temporalInstantEpoch(imported)).toBe(-1n);
});

it("rejects an accessor without invoking it and rejects a forged host brand", () => {
  let reads = 0;
  const instant = new TemporalBackend.Instant(1n);
  Object.defineProperty(instant, "epochNanoseconds", {get() { reads++; return 2n; }});
  expect(() => deepCopyToSandbox(instant)).toThrow("Instant accessor properties");
  expect(reads).toBe(0);
  expect(() => deepCopyToSandbox(Object.create(TemporalBackend.Instant.prototype))).toThrow(TypeError);
});

it("uses the receiving realm's Instant prototype for an imported binding", async () => {
  const result = await run("return [value instanceof Temporal.Instant,value.epochNanoseconds,value.toJSON()]", {
    bindings: {value: new TemporalBackend.Instant(-1n)}
  });
  expect(result).toMatchObject({ok:true,returnValue:[true,-1n,"1969-12-31T23:59:59.999999999Z"]});
});
