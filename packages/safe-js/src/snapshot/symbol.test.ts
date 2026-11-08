import { describe, expect, it } from "vitest";
import { hashSource } from "../parse/hash.js";
import { parseModule } from "../parse/parser.js";
import { restore as restoreDump } from "../restore.js";
import { EXECUTION_SEMANTICS, serializeSafeJSSnapshot } from "./dump-format.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { createSandboxDate } from "../interp/date.js";
import { boxedValue, createSandboxBox, isSandboxBox } from "../interp/boxed.js";

describe.each(["dump", "interpreter"])("symbol heap snapshots (%s)", format => {
  it.each(["object", "array", "date"])("preserves symbol aliases and symbol-keyed %s data without replaying their creation", kind => {
    const source = "await 0;";
    const statement = parseModule(source).body[0];
    if (statement?.type !== "ExpressionStatement" || statement.expression.nodeId === undefined)
      throw new Error("Expected await node");
    const key = Symbol("key");
    const other = Symbol("key");
    const anonymous = Symbol();
    const cycleKey = Symbol("cycle");
    const hiddenKey = Symbol("hidden");
    const box = createSandboxBox(key);
    Object.defineProperty(box, key, { value: box });
    const properties = { [key]: 7, [other]: 9, [anonymous]: 11 };
    const object = kind === "array" ? Object.assign([1, 2], properties) : kind === "date" ? Object.assign(createSandboxDate(7), properties) : properties;
    if (kind === "date") Object.defineProperty(object, "label", { value: object });
    Object.defineProperty(object, cycleKey, { value: object, enumerable: true });
    Object.defineProperty(object, hiddenKey, { value: object });
    if (kind === "date") Object.preventExtensions(object);
    const encoded = serialize({
      source,
      currentAstNodeId: statement.expression.nodeId,
      scopeChain: [{ id: "module", bindings: { key, alias: key, other, anonymous, cycleKey, hiddenKey, object, box, boxAlias: box } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    let snapshot = JSON.parse(JSON.stringify(encoded));
    if (format === "dump") {
      const envelope = JSON.parse(serializeSafeJSSnapshot({
        sourceHash: hashSource(source),
        executionSemantics: EXECUTION_SEMANTICS,
        bindings: { key, alias: key, other, anonymous, cycleKey, hiddenKey, object, box, boxAlias: box }
      }));
      const validated = restoreDump(envelope, { source });
      snapshot = { ...snapshot, scopeChain: [{ id: "module", bindings: validated.bindings }], heap: validated.heap };
    }
    const scope = restore(snapshot, { source }).currentScope;
    const restoredKey = scope.lookup("key");
    const restoredBox = scope.lookup("box");
    const restoredBoxAlias = scope.lookup("boxAlias");
    if (!restoredBox.found || !isSandboxBox(restoredBox.value) || !restoredBoxAlias.found || !restoredKey.found) throw new Error("Missing Symbol wrapper");
    expect(boxedValue(restoredBox.value)).toBe(restoredKey.value);
    expect(restoredBoxAlias.value).toBe(restoredBox.value);
    if (typeof restoredKey.value !== "symbol") throw new Error("Expected restored symbol");
    expect(Object.getOwnPropertyDescriptor(restoredBox.value, restoredKey.value)).toEqual({ value: restoredBox.value, enumerable: false, writable: false, configurable: false });
    const restoredAlias = scope.lookup("alias");
    const restoredObject = scope.lookup("object");
    const restoredOther = scope.lookup("other");
    const restoredAnonymous = scope.lookup("anonymous");
    const restoredCycleKey = scope.lookup("cycleKey");
    const restoredHiddenKey = scope.lookup("hiddenKey");
    if (!restoredKey.found || !restoredAlias.found || !restoredObject.found)
      throw new Error("Symbol bindings were lost");
    expect(typeof restoredKey.value).toBe("symbol");
    if (typeof restoredKey.value !== "symbol") throw new Error("Expected restored symbol");
    expect(restoredAlias.value).toBe(restoredKey.value);
    if (!restoredOther.found || !restoredAnonymous.found) throw new Error("Missing distinct symbols");
    expect(restoredOther.value).not.toBe(restoredKey.value);
    if (!restoredCycleKey.found || typeof restoredCycleKey.value !== "symbol") throw new Error("Missing cycle key");
    if (!restoredHiddenKey.found || typeof restoredHiddenKey.value !== "symbol") throw new Error("Missing hidden key");
    expect(Object.getOwnPropertySymbols(restoredObject.value)).toEqual([restoredKey.value, restoredOther.value, restoredAnonymous.value, restoredCycleKey.value, restoredHiddenKey.value]);
    expect(Object.getOwnPropertyDescriptor(restoredObject.value, restoredCycleKey.value)).toEqual({ value: restoredObject.value, enumerable: true, writable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(restoredObject.value, restoredHiddenKey.value)).toEqual({ value: restoredObject.value, enumerable: false, writable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(restoredObject.value, restoredKey.value)?.value).toBe(7);
    expect(Array.isArray(restoredObject.value)).toBe(kind === "array");
    if (kind === "date") {
      expect(Date.prototype.getTime.call(restoredObject.value)).toBe(7);
      expect(Object.isExtensible(restoredObject.value)).toBe(false);
      expect(Object.getOwnPropertyDescriptor(restoredObject.value, "label")).toEqual({ value: restoredObject.value, enumerable: false, writable: false, configurable: false });
    }
  });
});

describe("well-known symbol snapshots", () => {
  it.each([1, 2, 3])("rejects invalid boxed payload reference %s", id => {
    const source = "await 0;";
    expect(() => restoreDump({ version: 1, sourceHash: hashSource(source), executionSemantics: EXECUTION_SEMANTICS,
      bindings: { box: { kind: "ref", id: 1 } }, heap: {
        "1": { kind: "boxed", value: { kind: "ref", id }, properties: {}, extensible: true },
        "2": { kind: "object", entries: {} }
      }
    }, { source })).toThrow();
  });
  it.each([
    "invalid",
    [[{ kind: "ref", id: 2 }]],
    [["key", 7]],
    [[{ kind: "ref", id: 1 }, 7]],
    [[{ kind: "ref", id: 2 }, { value: 7, enumerable: true, writable: true, configurable: true }], [{ kind: "ref", id: 2 }, { value: 9, enumerable: true, writable: true, configurable: true }]],
    [[{ kind: "ref", id: 2 }, { value: 7, enumerable: "yes", writable: true, configurable: true }]],
    [[{ kind: "ref", id: 2 }, { enumerable: true, writable: true, configurable: true }]],
    [[{ kind: "ref", id: 2 }, { value: 7, get: null, enumerable: true, writable: true, configurable: true }]]
  ].map(symbolEntries => ({ symbolEntries })))("rejects malformed symbol property entries %j", ({ symbolEntries }) => {
    const source = "await 0;";
    expect(() => restoreDump({
      version: 1, sourceHash: hashSource(source), executionSemantics: EXECUTION_SEMANTICS,
      bindings: { object: { kind: "ref", id: 1 } },
      heap: {
        "1": { kind: "object", entries: {}, symbolEntries },
        "2": { kind: "symbol", description: "key" }
      }
    }, { source })).toThrow();
  });
  it.each([
    { kind: "symbol", wellKnown: "unknown" },
    { kind: "symbol", wellKnown: "toString" },
    { kind: "symbol", wellKnown: "iterator", description: "conflicting" },
    { kind: "symbol", description: 7 }
  ])("rejects malformed symbol metadata %j", entry => {
    const source = "await 0;";
    expect(() => restoreDump({
      version: 1, sourceHash: hashSource(source), executionSemantics: EXECUTION_SEMANTICS,
      bindings: { key: { kind: "ref", id: 1 } }, heap: { "1": entry }
    }, { source })).toThrow();
  });
  it("restores intrinsic symbol identity rather than a fresh description-only symbol", () => {
    const source = "await 0;";
    const statement = parseModule(source).body[0];
    if (statement?.type !== "ExpressionStatement" || statement.expression.nodeId === undefined)
      throw new Error("Expected await node");
    const snapshot = JSON.parse(JSON.stringify(serialize({
      source,
      currentAstNodeId: statement.expression.nodeId,
      scopeChain: [{ id: "module", bindings: { key: Symbol.iterator } }],
      callStack: [], pendingPromises: [], moduleBindings: {}
    })));
    expect(restore(snapshot, { source }).currentScope.lookup("key")).toMatchObject({ found: true, value: Symbol.iterator });
  });
});
