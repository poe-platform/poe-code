import { describe, expect, it } from "vitest";

import {
  createSandboxArguments,
  createSandboxClosure,
  createSandboxMap,
  createSandboxRegex,
  createSandboxSet,
  isSandboxArguments,
  isSandboxMap,
  isSandboxRegex,
  isSandboxSet
} from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

describe("replay result data", () => {
  it("round-trips explicitly registered capabilities without serializing executable code", () => {
    const closure = createSandboxClosure({ call: () => 42 });
    const encoded = encodeReplayData([closure, { callback: closure }], {
      identifyCapability: (value) => (value === closure ? "callback:1" : undefined)
    });
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encoded)), {
      resolveCapability: (id) => (id === "callback:1" ? closure : undefined)
    });
    expect(restored).toEqual([closure, { callback: closure }]);
    expect((restored as unknown[])[0]).toBe(closure);
    expect(() => decodeReplayData(encoded)).toThrow(/capability/i);
    expect(() => encodeReplayData(closure)).toThrow(/capability/i);
  });

  it("captures capability properties with cyclic references independently from rebound data", () => {
    const box: Record<string, any> = { value: 5 };
    const closure = createSandboxClosure({ call: () => 42, properties: { box } });
    box.owner = closure;
    const encoded = encodeReplayData([closure, box], {
      identifyCapability: () => "operation",
      captureCapabilityProperties: true
    });
    box.value = 99;
    const restored = decodeReplayData(encoded, { resolveCapability: () => closure }) as any[];
    expect(restored[0].call([])).toBe(42);
    expect(restored[0].properties.box).toBe(restored[1]);
    expect(restored[1].owner).toBe(restored[0]);
    expect(restored[1].value).toBe(5);
    expect(Object.isFrozen(restored[0].properties)).toBe(true);
  });

  it.each([undefined, "", 7, {}, "unknown"])(
    "rejects missing or invalid capability identity %s",
    (id) => {
      expect(() =>
        decodeReplayData(
          { root: { tag: "capability", id }, nodes: [] },
          {
            resolveCapability: () => undefined
          }
        )
      ).toThrow();
    }
  );

  it("preserves special numbers and user objects that look like serialization tags", () => {
    const value = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      -0,
      { tag: "ref", id: 0 },
      { kind: "number", value: "NaN" }
    ];
    expect(decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value))))).toEqual(value);
  });

  it("preserves cycles, aliases, sparse arrays and own property descriptors", () => {
    const value: Record<string, any> = Object.create(null);
    const array = new Array(3);
    array[1] = value;
    value.array = array;
    value.alias = array;
    Object.defineProperty(value, "hidden", { value: 5, enumerable: false });
    Object.freeze(value);
    const restored = decodeReplayData(
      JSON.parse(JSON.stringify(encodeReplayData(value)))
    ) as typeof value;
    expect(restored.array).toBe(restored.alias);
    expect(restored.array[1]).toBe(restored);
    expect(0 in restored.array).toBe(false);
    expect(restored.array.length).toBe(3);
    expect(Object.getPrototypeOf(restored)).toBe(null);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(restored, "hidden")).toEqual(
      Object.getOwnPropertyDescriptor(value, "hidden")
    );
  });

  it("round-trips collections, regular expressions and strict arguments", () => {
    const map = createSandboxMap();
    const set = createSandboxSet();
    map.entries.set("set", set);
    set.values.add(map);
    const regex = createSandboxRegex("a+", "g", 2);
    const args = createSandboxArguments([map, regex]);
    args.self = args;
    Object.freeze(args);
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(args))));
    expect(isSandboxArguments(restored)).toBe(true);
    if (!isSandboxArguments(restored)) throw new Error("Missing arguments");
    expect(restored.self).toBe(restored);
    expect(restored.length).toBe(2);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(isSandboxMap(restored[0])).toBe(true);
    if (!isSandboxMap(restored[0])) throw new Error("Missing map");
    const nested = restored[0].entries.get("set");
    expect(isSandboxSet(nested)).toBe(true);
    if (!isSandboxSet(nested)) throw new Error("Missing set");
    expect(nested.values.has(restored[0])).toBe(true);
    expect(isSandboxRegex(restored[1])).toBe(true);
    if (!isSandboxRegex(restored[1])) throw new Error("Missing regex");
    expect(restored[1].lastIndex).toBe(2);
  });

  it("does not invoke accessors while recording results", () => {
    let calls = 0;
    const value = Object.defineProperty({}, "secret", {
      get() {
        calls += 1;
        return 1;
      }
    });
    expect(() => encodeReplayData(value)).toThrow(/accessor/i);
    expect(calls).toBe(0);
  });

  it.each(["own", "inherited"])(
    "rejects %s accessors without invoking them while decoding",
    (kind) => {
      let calls = 0;
      const accessor = Object.defineProperty({}, kind === "own" ? "root" : "kind", {
        enumerable: true,
        get() {
          calls += 1;
          return undefined;
        }
      });
      const value = kind === "own" ? accessor : Object.create(accessor);
      expect(() => decodeReplayData(value)).toThrow();
      expect(calls).toBe(0);
    }
  );

  it.each([
    { root: { tag: "ref", id: 3 }, nodes: [] },
    { root: { tag: "number", value: "invalid" }, nodes: [] },
    {
      root: { tag: "ref", id: 0 },
      nodes: [
        {
          kind: "object",
          properties: {
            value: { value: 1, writable: "yes", enumerable: true, configurable: true }
          },
          extensible: true,
          nullPrototype: false
        }
      ]
    }
  ])("rejects corrupt data graphs", (value) => {
    expect(() => decodeReplayData(value)).toThrow();
  });
});
