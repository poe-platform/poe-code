import { describe, expect, it } from "vitest";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { createSandboxClosure, isSandboxClosure } from "../interp/values.js";
import { prepareReplayInputs } from "./replay-inputs.js";
import { boxedValue, createSandboxBox, isSandboxBox } from "../interp/boxed.js";

describe("Symbol replay data", () => {
  it("preserves the shared primitive identity of a Symbol wrapper", () => {
    const key = Symbol("key");
    const box = createSandboxBox(key);
    Object.defineProperty(box, key, { value: box });
    Object.preventExtensions(box);
    const decoded = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([key, box, box]))));
    if (!Array.isArray(decoded) || !isSandboxBox(decoded[1])) throw new Error("Expected Symbol wrapper");
    expect(boxedValue(decoded[1])).toBe(decoded[0]);
    expect(Object.getOwnPropertyDescriptor(decoded[1], decoded[0] as symbol)).toEqual({ value: decoded[1], enumerable: false, writable: false, configurable: false });
    expect(Object.isExtensible(decoded[1])).toBe(false);
    expect(decoded[1]).toBe(decoded[2]);
  });
  it("rejects non-symbol wrapper references before resolving capabilities", () => {
    let resolutions = 0;
    const boxed = { kind: "boxed", value: { tag: "ref", id: 1 }, properties: {}, extensible: true };
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [boxed, { kind: "capability", id: "host", properties: {} }] }, {
      resolveCapability: () => { resolutions++; return createSandboxClosure({ call: () => 7 }); }
    })).toThrow("Invalid boxed primitive payload");
    expect(resolutions).toBe(0);
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [{ ...boxed, value: { tag: "ref", id: 0 } }] })).toThrow("Invalid boxed primitive payload");
  });
  it("resolves symbol-keyed input capabilities when resuming a saved graph", async () => {
    const callback = createSandboxClosure({ call: () => 7 });
    const stringCallback = createSandboxClosure({ call: () => 9 });
    const current = { bindings: { callbacks: { 'symbol:1': stringCallback, '{"symbol":0}': stringCallback, [Symbol("key")]: callback } }, imports: {}, entryPointArgs: undefined, importMeta: {} };
    const saved = JSON.parse(JSON.stringify(prepareReplayInputs(current).snapshot));
    const restored = prepareReplayInputs(current, saved);
    const callbacks = restored.values.bindings.callbacks;
    expect(Object.getOwnPropertySymbols(callbacks)).toHaveLength(1);
    const key = Object.getOwnPropertySymbols(callbacks)[0]!;
    const restoredCallback = Object.getOwnPropertyDescriptor(callbacks, key)?.value;
    const restoredStringCallback = Object.getOwnPropertyDescriptor(callbacks, 'symbol:1')?.value;
    if (!isSandboxClosure(restoredCallback) || !isSandboxClosure(restoredStringCallback)) throw new Error("Expected restored callbacks");
    expect(await restoredCallback.call([], { stack: [], thisValue: undefined })).toBe(7);
    expect(await restoredStringCallback.call([], { stack: [], thisValue: undefined })).toBe(9);
  });
  it.each([{ symbol: -1 }, { symbol: 0.5 }, { symbol: 0, extra: true }, null])("rejects malformed symbol input paths %j", segment => {
    const current = { bindings: { callback: createSandboxClosure({ call: () => 7 }) }, imports: {}, entryPointArgs: undefined, importMeta: {} };
    const saved = JSON.parse(JSON.stringify(prepareReplayInputs(current).snapshot));
    const capability = saved.nodes.find((node: { kind: string }) => node.kind === "capability");
    capability.id = JSON.stringify(["bindings", segment]);
    expect(() => prepareReplayInputs(current, saved)).toThrow("Invalid replay input symbol capability path");
  });
  it.each([
    { kind: "symbol", description: 7 },
    { kind: "symbol", wellKnown: "toString" },
    { kind: "symbol", wellKnown: "unknown" },
    { kind: "symbol", wellKnown: "iterator", description: "conflicting" }
  ])("rejects malformed symbol metadata %j", node => {
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [node] })).toThrow();
  });

  it("preserves symbol aliases, descriptions and well-known identity", () => {
    const key = Symbol("key");
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([key, key, Symbol("key"), Symbol(), Symbol.iterator]))));
    if (!Array.isArray(restored)) throw new Error("Expected restored array");
    expect(typeof restored[0]).toBe("symbol");
    expect(restored[0]).toBe(restored[1]);
    expect(restored[0]).not.toBe(restored[2]);
    expect(String(restored[0])).toBe("Symbol(key)");
    expect(String(restored[3])).toBe("Symbol()");
    expect(restored[4]).toBe(Symbol.iterator);
  });

  it("gives distinct symbol slots distinct capability paths even with equal descriptions", () => {
    const first = createSandboxClosure({ call: () => 1 });
    const second = createSandboxClosure({ call: () => 2 });
    const paths: string[] = [];
    const capabilities = new Map<string, typeof first>();
    const encoded = encodeReplayData({ [Symbol("key")]: first, [Symbol("key")]: second }, {
      identifyCapability: (closure, path) => {
        const id = JSON.stringify(path);
        paths.push(id);
        capabilities.set(id, closure);
        return id;
      }
    });
    expect(new Set(paths).size).toBe(2);
    const decoded = decodeReplayData(JSON.parse(JSON.stringify(encoded)), { resolveCapability: id => capabilities.get(id) });
    expect(Object.getOwnPropertySymbols(decoded).map(key => Object.getOwnPropertyDescriptor(decoded, key)?.value)).toEqual([first, second]);
  });

  it("does not confuse a string property with a symbol capability path", () => {
    const stringCapability = createSandboxClosure({ call: () => 1 });
    const symbolCapability = createSandboxClosure({ call: () => 2 });
    const paths: string[] = [];
    const capabilities = new Map<string, typeof stringCapability>();
    const encoded = encodeReplayData({ "symbol:1": stringCapability, [Symbol("key")]: symbolCapability }, {
      identifyCapability: (closure, path) => {
        const id = JSON.stringify(path);
        paths.push(id);
        capabilities.set(id, closure);
        return id;
      }
    });
    expect(new Set(paths).size).toBe(2);
    const decoded = decodeReplayData(JSON.parse(JSON.stringify(encoded)), { resolveCapability: id => capabilities.get(id) });
    expect(Object.getOwnPropertyDescriptor(decoded, "symbol:1")?.value).toBe(stringCapability);
    const key = Object.getOwnPropertySymbols(decoded)[0]!;
    expect(Object.getOwnPropertyDescriptor(decoded, key)?.value).toBe(symbolCapability);
  });

  it.each(["object", "array"])("preserves symbol-keyed %s descriptors and cycles", kind => {
    const key = Symbol("key");
    const source = kind === "array" ? [] : {};
    Object.defineProperty(source, key, { value: source, enumerable: false, configurable: false, writable: false });
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([key, source]))));
    if (!Array.isArray(restored) || typeof restored[0] !== "symbol") throw new Error("Expected symbol and object");
    expect(Object.getOwnPropertyDescriptor(restored[1], restored[0])).toEqual({ value: restored[1], enumerable: false, configurable: false, writable: false });
    expect(Array.isArray(restored[1])).toBe(kind === "array");
  });
});
