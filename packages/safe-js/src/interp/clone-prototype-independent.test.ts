import { describe, expect, it, vi } from "vitest";

import {
  cloneSandboxValue,
  createSandboxMap,
  createSandboxSet,
  deepCopyToSandbox,
  isSandboxMap,
  isSandboxSet,
  measureSandboxData,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

describe("independent accepted-record clone provenance", () => {
  it("preserves mixed prototypes, cycles and map/set alias topology without mutating inputs", () => {
    const ordinary: SandboxObject = { label: "ack", accepted: true };
    const nullRecord = Object.assign(Object.create(null), { label: "guest" }) as SandboxObject;
    ordinary.self = ordinary;
    const original: SandboxObject = {
      ordinary,
      again: ordinary,
      nullRecord,
      map: createSandboxMap([[ordinary, nullRecord]]),
      set: createSandboxSet([ordinary, nullRecord])
    };
    const copied = cloneSandboxValue(original) as SandboxObject;
    const copiedOrdinary = copied.ordinary as SandboxObject;
    expect(copied).not.toBe(original);
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(copiedOrdinary)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(copied.nullRecord)).toBeNull();
    expect(copiedOrdinary).not.toBe(ordinary);
    expect(copied.again).toBe(copiedOrdinary);
    expect(copiedOrdinary.self).toBe(copiedOrdinary);
    expect(Reflect.ownKeys(copiedOrdinary)).toEqual(["label", "accepted", "self"]);
    expect(Object.getOwnPropertyDescriptor(copiedOrdinary, "label")).toEqual({
      value: "ack",
      enumerable: true,
      configurable: true,
      writable: true
    });
    if (!isSandboxMap(copied.map) || !isSandboxSet(copied.set)) {
      throw new Error("Collection kinds changed");
    }
    expect([...copied.map.entries.keys()]).toEqual([copiedOrdinary]);
    expect(copied.map.entries.get(copiedOrdinary)).toBe(copied.nullRecord);
    expect([...copied.set.values]).toEqual([copiedOrdinary, copied.nullRecord]);
    expect(measureSandboxData([copied])).toBe(measureSandboxData([original]));
    expect(ordinary.self).toBe(ordinary);
    expect(Object.getPrototypeOf(ordinary)).toBe(Object.prototype);
  });

  it("keeps public ingress normalization distinct from clone provenance", () => {
    const input = { ordinary: { label: "input" } };
    const normalized = deepCopyToSandbox(input) as SandboxObject;
    expect(Object.getPrototypeOf(normalized)).toBeNull();
    expect(Object.getPrototypeOf(normalized.ordinary)).toBeNull();
    const copied = cloneSandboxValue(normalized) as SandboxObject;
    expect(Object.getPrototypeOf(copied)).toBeNull();
    expect(Object.getPrototypeOf(copied.ordinary)).toBeNull();
    expect(Object.getPrototypeOf(input.ordinary)).toBe(Object.prototype);
  });

  it("does not accept an ordinary-looking custom prototype or a native callable", () => {
    const custom = Object.create({ label: "inherited" }) as SandboxValue;
    expect(() => cloneSandboxValue(custom)).toThrow(TypeError);
    expect(() => deepCopyToSandbox(custom)).toThrow(TypeError);
    const native = vi.fn(() => "unused");
    expect(() => cloneSandboxValue({ native } as unknown as SandboxValue)).toThrow(TypeError);
    expect(native).not.toHaveBeenCalled();
  });

  it("does not invoke data accessors or native toJSON during cloning", () => {
    const getter = vi.fn(() => "unused");
    const accessor = Object.defineProperty({}, "label", { enumerable: true, get: getter });
    expect(() => cloneSandboxValue(accessor)).toThrow(/accessor property/);
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => ({ changed: true }));
    expect(() => cloneSandboxValue({ toJSON } as unknown as SandboxValue)).toThrow(TypeError);
    expect(toJSON).not.toHaveBeenCalled();
  });
});
