import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { digestHostCallArguments } from "./host-call.js";

const digest = (encoded: string) => createHash("sha256").update(encoded).digest("hex");

describe("inert host argument digest representation", () => {
  it("omits callable record data without dispatching its toJSON", () => {
    const toJSON = vi.fn(() => 7);
    const input = { value: 7, toJSON, alias: toJSON };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    expect(digestHostCallArguments([input])).toBe(digest('[{"value":7}]'));
    expect(toJSON).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptors(input)).toStrictEqual(descriptors);
  });

  it("retains named callable array data only on the actual input", () => {
    const toJSON = vi.fn(() => 7);
    const input = Object.assign([7], { toJSON, metadata: 1 });
    expect(digestHostCallArguments([input])).toBe(digest("[[7]]"));
    expect(input.toJSON).toBe(toJSON);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("never inspects serialization hooks on callable values", () => {
    const toJSON = vi.fn(() => 7);
    const callback = Object.assign(() => 1, { toJSON });
    const input = { callback, value: 7 };
    expect(digestHostCallArguments([input, callback])).toBe(digest('[{"value":7},null]'));
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("rejects selected record accessors without evaluation", () => {
    const getter = vi.fn(() => 7);
    const input = {};
    Object.defineProperty(input, "toJSON", { enumerable: true, get: getter });
    expect(() => digestHostCallArguments([input])).toThrow("accessor");
    expect(getter).not.toHaveBeenCalled();
  });

  it("ignores unselected hidden and inherited data without invoking hooks", () => {
    const toJSON = vi.fn(() => 7);
    const getter = vi.fn(() => 8);
    const input = Object.create({ toJSON }) as Record<string, unknown>;
    Object.defineProperty(input, "value", { value: 7, enumerable: true });
    Object.defineProperty(input, "hidden", { get: getter });
    expect(digestHostCallArguments([input])).toBe(digest('[{"value":7}]'));
    expect(toJSON).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it("retains inert special own keys without prototype inheritance", () => {
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "__proto__", {
      value: { toJSON: () => 7, value: 8 },
      enumerable: true
    });
    Object.defineProperty(input, "constructor", { value: 9, enumerable: true });
    expect(digestHostCallArguments([input])).toBe(
      digest('[{"__proto__":{"value":8},"constructor":9}]')
    );
    expect(Object.getPrototypeOf(input)).toBe(null);
  });

  it("produces only null-prototype noncallable containers before JSON encoding", () => {
    const stringify = JSON.stringify;
    const seenContainers: object[] = [];
    const spy = vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
      const visit = (entry: unknown): void => {
        if (entry === null || typeof entry !== "object") return;
        seenContainers.push(entry);
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(entry))) {
          if ("value" in descriptor) visit(descriptor.value);
        }
      };
      visit(value);
      return stringify(value);
    });
    try {
      const input = {
        value: undefined,
        number: Infinity,
        toJSON: () => 7,
        nested: [undefined, NaN]
      };
      digestHostCallArguments([input]);
    } finally {
      spy.mockRestore();
    }
    expect(seenContainers.length).toBeGreaterThan(5);
    for (const entry of seenContainers) {
      expect(Object.getPrototypeOf(entry)).toBe(null);
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(entry))) {
        expect("value" in descriptor).toBe(true);
        expect(typeof descriptor.value).not.toBe("function");
      }
    }
  });

  it("preserves established hook-free bytes, key order, sparse presence and alias handling", () => {
    const shared = { zebra: 7, apple: undefined, callback: () => 1 };
    const sparse = new Array<unknown>(4);
    sparse[1] = undefined;
    sparse[2] = shared;
    const input = [shared, sparse, shared, NaN, Infinity, -Infinity, -0, null, true, "text"];
    const encoded =
      '[{"apple":{"$type":"undefined"},"zebra":7},[null,{"$type":"undefined"},{"apple":{"$type":"undefined"},"zebra":7},null],{"apple":{"$type":"undefined"},"zebra":7},{"$type":"number","value":"NaN"},{"$type":"number","value":"Infinity"},{"$type":"number","value":"-Infinity"},0,null,true,"text"]';
    expect(digestHostCallArguments(input)).toBe(digest(encoded));
    expect(Object.hasOwn(sparse, "0")).toBe(false);
    expect(Object.hasOwn(sparse, "1")).toBe(true);
  });

  it("rejects unsupported bigint before entering JSON encoding", () => {
    const spy = vi.spyOn(JSON, "stringify");
    let encodedCalls: number;
    try {
      expect(() => digestHostCallArguments([1n])).toThrow(TypeError);
      encodedCalls = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
    expect(encodedCalls).toBe(0);
  });

  it("retains ordinary and indexed cycle rejection", () => {
    const record: Record<string, unknown> = {};
    record.self = record;
    const array: unknown[] = [];
    array[0] = array;
    expect(() => digestHostCallArguments([record])).toThrow("cannot contain cycles");
    expect(() => digestHostCallArguments([array])).toThrow("cannot contain cycles");
  });
});
