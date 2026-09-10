import { expect, it } from "vitest";
import { Temporal } from "temporal-polyfill/full/implementation";
import { createHostTemporalInstant, hostTemporalInstantEpoch } from "./temporal-instant.js";

it("reads the captured host brand without invoking an own epoch getter", () => {
  const instant = new Temporal.Instant(-1n);
  let reads = 0;
  Object.defineProperty(instant, "epochNanoseconds", { get() { reads++; return 2n; } });
  expect(hostTemporalInstantEpoch(instant)).toBe(-1n);
  expect(reads).toBe(0);
});

it("rejects a forged host prototype even when it has an epoch property", () => {
  const forged = Object.create(Temporal.Instant.prototype);
  Object.defineProperty(forged, "epochNanoseconds", { value: 1n });
  expect(() => hostTemporalInstantEpoch(forged)).toThrow(TypeError);
});

it("does not invoke proxy traps, including for a revoked proxy", () => {
  let traps = 0;
  const proxy = new Proxy(new Temporal.Instant(0n), {
    getPrototypeOf() { traps++; return Temporal.Instant.prototype; }
  });
  expect(hostTemporalInstantEpoch(proxy)).toBeUndefined();
  expect(traps).toBe(0);
  const revoked = Proxy.revocable(new Temporal.Instant(0n), {});
  revoked.revoke();
  expect(hostTemporalInstantEpoch(revoked.proxy)).toBeUndefined();
});

it("admits a null prototype only for tracked exports", () => {
  const exported = createHostTemporalInstant(1n);
  Object.setPrototypeOf(exported, null);
  expect(hostTemporalInstantEpoch(exported)).toBe(1n);
  const arbitrary = new Temporal.Instant(1n);
  Object.setPrototypeOf(arbitrary, null);
  expect(hostTemporalInstantEpoch(arbitrary)).toBeUndefined();
});

it("rejects custom prototypes on tracked exports", () => {
  const exported = createHostTemporalInstant(0n);
  Object.setPrototypeOf(exported, { epochNanoseconds: 0n });
  expect(() => hostTemporalInstantEpoch(exported)).toThrow("Custom host Instant prototypes");
});
