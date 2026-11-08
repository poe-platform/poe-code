import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { arrayBufferPrototypes } from "./array-buffer.js";
import { getSandboxPrototype, setSandboxPrototype } from "./object-model.js";
import { typedArrayPrototypes } from "./typed-array-prototypes.js";

it.each([null, { captured: "retained" }])("resolves explicit prototype %s without a redundant membership lookup", parent => {
  const value = {};
  setSandboxPrototype(value, parent);
  const membership = vi.spyOn(WeakMap.prototype, "has");
  try {
    const actual = getSandboxPrototype(value);
    const duplicateReads = membership.mock.calls.filter(([key]) => key === value).length;
    expect(actual).toBe(parent);
    expect(duplicateReads).toBe(0);
  } finally { membership.mockRestore(); }
});

it("does not classify intrinsic kinds when no realm fallback can be resolved", () => {
  const values = [{}, [], new ArrayBuffer(8), new Float32Array(2), new Uint8Array(2)];
  const classify = vi.spyOn(ArrayBuffer, "isView");
  try {
    const result = values.map(value => getSandboxPrototype(value));
    const calls = classify.mock.calls.length;
    expect(result).toEqual(values.map(() => null));
    expect(calls).toBe(0);
  } finally {
    classify.mockRestore();
  }
});

it("keeps explicit prototype links without a realm", () => {
  const budget = new Budget();
  const value = {};
  const parent = { captured: "retained" };
  setSandboxPrototype(value, parent, budget);
  expect(getSandboxPrototype(value)).toBe(parent);
  setSandboxPrototype(value, null, budget);
  expect(getSandboxPrototype(value)).toBeNull();
});

it("still resolves buffer and concrete typed-array fallbacks within a realm", () => {
  const budget = new Budget();
  const bufferPrototype = {};
  const floatPrototype = {};
  const bytePrototype = {};
  arrayBufferPrototypes.set(budget, bufferPrototype);
  typedArrayPrototypes.set(budget, new Map([
    [Float32Array, floatPrototype],
    [Uint8Array, bytePrototype]
  ]));
  expect(getSandboxPrototype(new ArrayBuffer(8), budget)).toBe(bufferPrototype);
  expect(getSandboxPrototype(new Float32Array(2), budget)).toBe(floatPrototype);
  expect(getSandboxPrototype(new Uint8Array(2), budget)).toBe(bytePrototype);
});
