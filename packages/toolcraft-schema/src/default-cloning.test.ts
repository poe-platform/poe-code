import { describe, expect, it, vi } from "vitest";
import { cloneDefaultValue, S, validate } from "./index.js";

describe("default cloning", () => {
  it("isolates plain graphs while preserving cycles and repeated references", () => {
    const shared = { tags: ["seed"] };
    const original = { first: shared, second: shared };
    Object.assign(shared, { parent: original });

    const cloned = cloneDefaultValue(original);

    expect(cloned).not.toBe(original);
    expect(cloned.first).not.toBe(shared);
    expect(cloned.first).toBe(cloned.second);
    expect(cloned.first).toHaveProperty("parent", cloned);
    cloned.first.tags.push("changed");
    expect(shared.tags).toEqual(["seed"]);
  });

  it("retains the validator's native cloning behavior for fully cloneable defaults", () => {
    const shared = { tags: ["seed"] };
    const original = { first: shared, second: shared, date: new Date(0), map: new Map([["shared", shared]]) };
    const schema = S.Object({ settings: S.Optional(S.Object({}, {
      additionalProperties: true,
      default: original
    })) });

    const result = validate(schema, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid default result");
    const cloned = result.value.settings as typeof original;

    expect(cloned.first).not.toBe(shared);
    expect(cloned.first).toBe(cloned.second);
    expect(cloned.map.get("shared")).toBe(cloned.first);
    expect(cloned.date).toEqual(original.date);
    expect(cloned.date).not.toBe(original.date);
    cloned.first.tags.push("changed");
    expect(shared.tags).toEqual(["seed"]);
  });

  it("preserves plain cycles, sparse arrays and prototype-safe keys around callable extras", () => {
    const original = Object.assign(Object.create(null), { callback: () => 42, items: new Array(3) });
    original.self = original;
    Object.defineProperty(original, "__proto__", { value: { tags: [] }, enumerable: true });

    const cloned = cloneDefaultValue(original);

    expect(Object.getPrototypeOf(cloned)).toBeNull();
    expect(cloned.self).toBe(cloned);
    expect(cloned.callback).toBe(original.callback);
    expect(cloned.items).toHaveLength(3);
    expect(0 in cloned.items).toBe(false);
    expect(cloned.items).not.toBe(original.items);
    expect(Object.hasOwn(cloned, "__proto__")).toBe(true);
    expect(cloned.__proto__).not.toBe(original.__proto__);
  });

  it("retains opaque resources when a default cannot be structurally cloned", () => {
    const resource = new WeakMap<object, unknown>();
    const original = { resource, items: [] as string[] };

    const cloned = cloneDefaultValue(original);

    expect(cloned.resource).toBe(resource);
    expect(cloned.items).not.toBe(original.items);
  });

  it("propagates non-cloning errors without retrying getters", () => {
    const failure = new Error("getter failed");
    const getter = vi.fn(() => { throw failure; });
    const original = Object.defineProperty({}, "value", { get: getter, enumerable: true });

    expect(() => cloneDefaultValue(original)).toThrow(failure);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("preserves callable extras while cloning default containers", () => {
    const callback = () => 42;
    const defaultValue = { items: [] as string[], callback };
    const schema = S.Object({ settings: S.Optional(S.Object({ items: S.Array(S.String()) }, {
      additionalProperties: true,
      default: defaultValue
    })) });

    const first = validate(schema, {});
    const second = validate(schema, {});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected valid default results");

    const firstSettings = first.value.settings as typeof defaultValue;
    const secondSettings = second.value.settings as typeof defaultValue;
    firstSettings.items.push("changed");

    expect(firstSettings.callback).toBe(callback);
    expect(firstSettings.callback()).toBe(42);
    expect(secondSettings.items).toEqual([]);
    expect(defaultValue.items).toEqual([]);
  });
});
