import { expect, it, vi } from "vitest";
import { typedArrayDataProperties } from "./typed-array.js";
import { hasGuestObjectState, markDescriptorObject } from "./object-model.js";

it("checks descriptor-marked typed-array state without materializing numeric descriptors", () => {
  const value = new Float32Array(16);
  Object.defineProperty(value, "extra", { value: 7 });
  markDescriptorObject(value);
  const all = vi.spyOn(Object, "getOwnPropertyDescriptors");
  try {
    expect(hasGuestObjectState(value)).toBe(true);
    expect(all.mock.calls.filter(([target]) => target === value)).toHaveLength(0);
  } finally {
    all.mockRestore();
  }
});

it("collects metadata without allocating numeric element descriptors", () => {
  const value = new Float32Array(16);
  const metadata = { retained: true };
  Object.defineProperty(value, "extra", { value: metadata, configurable: true });
  const all = vi.spyOn(Object, "getOwnPropertyDescriptors");
  const single = vi.spyOn(Object, "getOwnPropertyDescriptor");
  try {
    const properties = typedArrayDataProperties(value);
    const dictionaries = all.mock.calls.length;
    const keys = single.mock.calls.filter(([target]) => target === value).map(([, key]) => key);
    all.mockRestore();
    single.mockRestore();
    expect(properties).toEqual([["extra", {
      value: metadata, writable: false, enumerable: false, configurable: true
    }]]);
    expect(properties[0]![1].value).toBe(metadata);
    expect(dictionaries).toBe(0);
    expect(keys).toEqual(["extra"]);
  } finally {
    all.mockRestore();
    single.mockRestore();
  }
});

it("preserves noncanonical numeric names and metadata order", () => {
  const value = new Float32Array(2);
  Object.defineProperties(value, {
    "01": { value: 1 },
    "1.0": { value: 2 },
    extra: { value: 3 }
  });
  expect(typedArrayDataProperties(value).map(([key, descriptor]) => [key, descriptor.value]))
    .toEqual([["01", 1], ["1.0", 2], ["extra", 3]]);
});

it("rejects accessor metadata without invoking it", () => {
  const value = new Float32Array(2);
  const getter = vi.fn(() => 1);
  Object.defineProperty(value, "extra", { get: getter });
  expect(() => typedArrayDataProperties(value)).toThrow("accessor property 'extra'");
  expect(getter).not.toHaveBeenCalled();
});

it("rejects symbol metadata before inspecting string properties", () => {
  const value = new Float32Array(2);
  Object.defineProperty(value, Symbol("private"), { value: 1 });
  Object.defineProperty(value, "extra", { get: () => { throw new Error("must not run"); } });
  expect(() => typedArrayDataProperties(value)).toThrow("symbol properties");
});
