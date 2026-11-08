import { expect, it, vi } from "vitest";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { markDescriptorObject } from "./object-model.js";

it("does not inspect every hole when measuring a sparse array", () => {
  const value = new Array(2048);
  value[2047] = "abc";
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
  try {
    expect(measureSandboxData([value])).toBe(2052);
    expect(descriptors.mock.calls.filter(([owner]) => owner === value)).toHaveLength(1);
  } finally { descriptors.mockRestore(); }
});

it("captures array elements before retained callbacks can hide sibling data", () => {
  const value: unknown[] = [];
  value.push(createSandboxClosure({call: () => undefined, retainedValues: () => {
    value[1] = "";
    return [];
  }}), "x".repeat(400));
  expect(measureSandboxData([value])).toBe(404);
  expect(value[1]).toBe("");
});

it("counts non-enumerable indices without invoking accessors", () => {
  const value = new Array(3);
  const getter = vi.fn(() => { throw new Error("must not run"); });
  Object.defineProperty(value, "0", { value: "abc" });
  Object.defineProperty(value, "1", { get: getter });
  expect(measureSandboxData([value])).toBe(7);
  expect(getter).not.toHaveBeenCalled();
});

it("preserves unmanaged named-property and managed descriptor accounting", () => {
  const value = ["abc"];
  Object.defineProperty(value, "extra", { value: "xy" });
  expect(measureSandboxData([value])).toBe(5);
  markDescriptorObject(value);
  expect(measureSandboxData([value])).toBe(15);
});

it("captures deleted siblings and terminates cycles", () => {
  const value: unknown[] = [];
  value.push(createSandboxClosure({ call: () => undefined, retainedValues: () => {
    value.length = 0;
    return [];
  }}), "x".repeat(400), value);
  expect(measureSandboxData([value])).toBe(405);
});

it("preserves descriptor-visible proxy indices omitted by ownKeys", () => {
  const value = new Proxy(["abc"], {
    ownKeys: () => ["length"]
  });
  expect(measureSandboxData([value])).toBe(5);
});
