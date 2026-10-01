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
  isSandboxSet,
  getRegexProperties,
  type SandboxValue
} from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { setSandboxPrototype } from "../interp/object-model.js";
import { getCollectionProperties } from "../interp/collection-properties.js";

describe("replay result data", () => {
  it("keeps serialization operations private when native generator methods are replaced", () => {
    const prototype = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "next")!;
    let exposed = false;
    Object.defineProperty(prototype, "next", { ...descriptor, value() {
      exposed = true;
      throw new Error("Private serialization operation exposed");
    } });
    let encoded: ReturnType<typeof encodeReplayData>;
    try { encoded = encodeReplayData({ child: 7 }); }
    finally { Object.defineProperty(prototype, "next", descriptor); }
    expect(exposed).toBe(false);
    expect(decodeReplayData(encoded)).toEqual({ child: 7 });
  });

  it("records and restores deeply nested data without native recursion", () => {
    let input: { child?: object } = {};
    for (let depth = 0; depth < 2500; depth++) input = { child: input };
    const encoded = encodeReplayData(input);
    expect(encoded.nodes).toHaveLength(2501);
    let restored = decodeReplayData(encoded) as { child?: object };
    for (let depth = 0; depth < 2500; depth++) {
      expect(restored).toHaveProperty("child");
      restored = restored.child as typeof restored;
    }
    expect(restored).toEqual({});
  });

  it.each(["symbol", "collection", "regexp", "arguments"])("records deep %s property chains without native recursion", kind => {
    const depth = 2500;
    let input: SandboxValue = "leaf";
    for (let index = 0; index < depth; index++) {
      if (kind === "symbol") input = { [Symbol.iterator]: input };
      else if (kind === "collection") {
        const collection = index % 2 === 0 ? createSandboxMap() : createSandboxSet();
        getCollectionProperties(collection).child = input;
        input = collection;
      } else if (kind === "regexp") {
        const regex = createSandboxRegex("a", "");
        getRegexProperties(regex).child = input;
        input = regex;
      } else input = createSandboxArguments([input]);
    }
    let restored = decodeReplayData(encodeReplayData(input));
    for (let index = 0; index < depth; index++) {
      if (isSandboxMap(restored) || isSandboxSet(restored)) restored = getCollectionProperties(restored).child;
      else if (isSandboxRegex(restored)) restored = getRegexProperties(restored).child;
      else if (isSandboxArguments(restored)) restored = restored[0];
      else restored = (restored as { [Symbol.iterator]: SandboxValue })[Symbol.iterator];
    }
    expect(restored).toBe("leaf");
  });

  it("does not discard an unsupported prototype on a capability property table", () => {
    const closure = createSandboxClosure({call: () => 7, properties: {extra: 1}});
    setSandboxPrototype(closure.properties!, {inherited: 7});
    expect(() => encodeReplayData(closure, {
      identifyCapability: () => "fn", captureCapabilityProperties: true
    })).toThrow("prototype links");
  });
  it.each([false, true])("preserves aliases to a capability property table across graph roots (table first=%s)", tableFirst => {
    const closure = createSandboxClosure({call: () => 7, properties: {extra: 1}});
    Object.defineProperty(closure.properties!, "name", {value: "fn", configurable: true});
    const encoded = encodeReplayData(tableFirst ? [closure.properties, closure] : [closure, closure.properties], {
      identifyCapability: () => "fn", captureCapabilityProperties: true
    });
    const values = decodeReplayData(encoded, {resolveCapability: () => closure}) as any[];
    const restored = tableFirst ? [values[1], values[0]] : values;
    expect(restored[0].properties).toBe(restored[1]);
    restored[1].extra = 2;
    expect(restored[0].properties.extra).toBe(2);
    expect(closure.properties?.extra).toBe(1);
  });
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
    expect(Object.isFrozen(restored[0].properties)).toBe(false);
    restored[0].properties.extra = 7;
    expect(closure.properties).not.toHaveProperty("extra");
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
