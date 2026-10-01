import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import * as native from "../dist/mcp-result.js";
import * as reference from "../../toolcraft/src/mcp-result.js";

const marker = Symbol.for("toolcraft.mcp-result");

describe.each([["native", native], ["reference", reference]] as const)("%s MCP markers", (_, lib) => {
  it("retains shallow references, enumerable symbols and ordinary copy descriptors", () => {
    const extra = Symbol("extra");
    const content: unknown[] = [];
    const source = Object.freeze(Object.create({ inherited: 1 }, Object.getOwnPropertyDescriptors({
      content, [extra]: content, [marker]: false, ["__proto__"]: content
    })));
    const result = lib.asMCPResult(source);
    expect(result).not.toBe(source);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.content).toBe(content);
    expect(result[extra]).toBe(content);
    expect(result.__proto__).toBe(content);
    expect(Object.hasOwn(result, "inherited")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(result, marker)).toEqual({
      value: true, enumerable: true, configurable: true, writable: true
    });
    const unmarked = lib.asMCPResult({ content: [] });
    expect(Object.getOwnPropertyDescriptor(unmarked, marker)).toEqual({
      value: true, enumerable: false, configurable: false, writable: false
    });
    expect(source[marker]).toBe(false);
    expect(lib.isMCPResult(result)).toBe(true);
  });

  it("validates once before spreading in own-key order without revalidating the copy", () => {
    const reads: PropertyKey[] = [];
    let accesses = 0;
    const source = new Proxy({ before: 1, get content() { return ++accesses === 1 ? [] : "later"; } }, {
      get(target, key, receiver) { reads.push(key); return Reflect.get(target, key, receiver); }
    });
    const result = lib.asMCPResult(source as never);
    expect(reads).toEqual(["content", "before", "content"]);
    expect(result).toEqual({ before: 1, content: "later" });
    expect(lib.isMCPResult(result)).toBe(true);
    const inherited = Object.create({ content: [] });
    expect(lib.asMCPResult(inherited)).toEqual({});
  });

  it("accepts arrays from other realms and rejects non-envelopes without reading content", () => {
    const content = runInNewContext("[]");
    expect(lib.asMCPResult({ content }).content).toBe(content);
    for (const value of [null, undefined, true, 3, 4n, Symbol(), "x", [], () => {}, {}, { content: {} }]) {
      expect(() => lib.asMCPResult(value as never)).toThrow(new TypeError("MCP results must contain a content array."));
    }
    const array = Object.defineProperty([], "content", { get() { throw new Error("must not read"); } });
    expect(() => lib.asMCPResult(array as never)).toThrow("MCP results must contain a content array.");
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => lib.asMCPResult(revoked.proxy as never)).toThrow(TypeError);
  });

  it("recognizes inherited markers on objects and arrays but not on functions", () => {
    for (const value of [Object.create({ [marker]: true }), Object.assign([], { [marker]: true })]) {
      expect(lib.isMCPResult(value)).toBe(true);
    }
    for (const value of [null, undefined, "x", 1, Object.assign(() => {}, { [marker]: true }), { [marker]: 1 }, { [marker]: new Boolean(true) }]) {
      expect(lib.isMCPResult(value)).toBe(false);
    }
    const source = Object.create({ get [marker]() { return this.owned; } });
    source.owned = true;
    expect(lib.isMCPResult(source)).toBe(true);
  });

  it("reads the array predicate before invoking the content getter", () => {
    const original = Array.isArray;
    try {
      const source = { get content() { Array.isArray = () => false; return []; } };
      expect(lib.isMCPResult(lib.asMCPResult(source))).toBe(true);
    } finally {
      Array.isArray = original;
    }
  });

  it("preserves arbitrary thrown values from content, spread and marker access", () => {
    for (const thrown of [undefined, null, false, 0, "reason", Symbol("reason"), { toString() { throw new Error("do not stringify"); } }]) {
      for (const operation of [
        () => lib.asMCPResult({ get content() { throw thrown; } }),
        () => lib.asMCPResult({ content: [], get extra() { throw thrown; } }),
        () => lib.isMCPResult({ get [marker]() { throw thrown; } })
      ]) {
        let caught = false;
        try { operation(); } catch (error) { caught = true; expect(error).toBe(thrown); }
        expect(caught).toBe(true);
      }
    }
  });
});
