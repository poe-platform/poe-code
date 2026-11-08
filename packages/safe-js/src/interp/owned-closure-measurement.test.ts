import { afterEach, expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { asyncDisposableStackStates } from "./async-disposable-stack.js";
import { disposableStackStates } from "./disposable-stack.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { moduleNamespaceRetainedValues } from "./module-namespace.js";
import { setSandboxPrototype } from "./object-model.js";
import { addPrivateElement } from "./private-state.js";
import * as objectModel from "./object-model.js";
import * as hostCapabilities from "./host-capabilities.js";
import { createWeakCollection, setWeakEntry, weakCollectionStates } from "./weak-collection.js";
import {
  dynamicSourceRecords,
  dynamicValueSources,
  type DynamicSource
} from "../parse/function-source.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

afterEach(() => vi.restoreAllMocks());

it("does not inspect unused stack, array and host types for SDK-owned closures", () => {
  const closure = createSandboxClosure({ call: () => undefined });
  const disposable = vi.spyOn(disposableStackStates, "get");
  const asyncDisposable = vi.spyOn(asyncDisposableStackStates, "get");
  const array = vi.spyOn(Array, "isArray");
  const host = vi.spyOn(hostCapabilities, "isGuestHostObject");
  expect(measureSandboxData([closure])).toBe(1);
  for (const reads of [
    disposable.mock.calls,
    asyncDisposable.mock.calls,
    array.mock.calls,
    host.mock.calls
  ])
    expect(reads.filter(([value]) => value === closure)).toHaveLength(0);
});

it("keeps general state inspection for foreign frozen objects inheriting a closure marker", () => {
  const closure = createSandboxClosure({ call: () => undefined, retainedValues: () => ["abc"] });
  const foreign = Object.freeze(Object.create(closure));
  const inspect = vi.spyOn(weakCollectionStates, "get");
  expect(measureSandboxData([foreign])).toBe(4);
  expect(inspect.mock.calls.some(([value]) => value === foreign)).toBe(true);
});

it("retains private slots, prototypes, aliases and held quota enforcement", () => {
  const payload = { text: "small" };
  const closure = createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
  addPrivateElement(closure, { description: "payload" }, { kind: "field", value: payload });
  setSandboxPrototype(closure, { payload });
  const before = measureSandboxData([closure]);
  payload.text = "x".repeat(1005);
  expect(measureSandboxData([closure]) - before).toBe(1000);
  const budget = new Budget({ dataSize: before + 500 });
  const release = budget.deferReconciliation();
  try {
    expect(() => reconcileCompiledValues(budget, [closure])).toThrow(SandboxError);
  } finally {
    release();
  }
});

it("preserves callable proxy target and handler accounting before closure inspection", () => {
  const payload = { text: "small" };
  const target = createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
  const proxy = createGuestProxy(target, { marker: "handler" });
  const before = measureSandboxData([proxy]);
  payload.text = "x".repeat(1005);
  expect(measureSandboxData([proxy]) - before).toBe(1000);
  revokeGuestProxy(proxy);
  expect(measureSandboxData([proxy])).toBe(1);
});

it("preserves weak contributions for foreign collections inheriting a closure marker", () => {
  const collection = createWeakCollection("map");
  const key = {};
  setWeakEntry(collection, key, { text: "x".repeat(1000) });
  Object.setPrototypeOf(collection, createSandboxClosure({ call: () => undefined }));
  expect(measureSandboxData([collection, key])).toBe(1009);
});

it("preserves repeated SDK property table observations", () => {
  const closure = createSandboxClosure({ call: () => undefined, properties: { text: "abc" } });
  const read = vi.spyOn(objectModel, "getGuestFunctionProperties");
  expect(measureSandboxData([closure])).toBe(10);
  expect(read.mock.calls.filter(([value]) => value === closure)).toHaveLength(2);
});

it("preserves native WeakMap getter observations and quota enforcement", () => {
  const closure = createSandboxClosure({ call: () => undefined });
  const retained = { text: "x".repeat(1000) };
  const get = WeakMap.prototype.get;
  const table: { value?: WeakMap<object, unknown> } = {};
  vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
    this: WeakMap<object, unknown>,
    key: object
  ) {
    if (key === closure) table.value = this;
    return get.call(this, key);
  });
  void closure.properties;
  vi.restoreAllMocks();
  let reads = 0;
  vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
    this: WeakMap<object, unknown>,
    key: object
  ) {
    if (this === table.value && key === closure) return ++reads === 1 ? {} : retained;
    return get.call(this, key);
  });
  expect(measureSandboxData([closure])).toBe(1007);
  expect(reads).toBe(2);
  reads = 0;
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 500 }), [closure])).toThrow(
    SandboxError
  );
});

it("keeps repeated foreign property getter observations", () => {
  const base = createSandboxClosure({ call: () => undefined });
  const foreign = Object.create(base);
  const retained = { text: "x".repeat(1000) };
  let reads = 0;
  Object.defineProperty(foreign, "properties", {
    get: () => (++reads === 1 ? {} : retained)
  });
  Object.freeze(foreign);
  expect(measureSandboxData([foreign])).toBe(1 + measureSandboxData([retained]));
  expect(reads).toBe(2);
});

it("keeps repeated reads when a native construction hook supplies a foreign getter", () => {
  const retained = { text: "x".repeat(1000) };
  const define = Object.defineProperty;
  let reads = 0;
  vi.spyOn(Object, "defineProperty").mockImplementation((owner, key, descriptor) =>
    define(
      owner,
      key,
      key === "properties"
        ? {
            ...descriptor,
            get: () => (++reads === 1 ? {} : retained)
          }
        : descriptor
    )
  );
  const closure = createSandboxClosure({ call: () => undefined });
  vi.restoreAllMocks();
  expect(measureSandboxData([closure])).toBe(1 + measureSandboxData([retained]));
  expect(reads).toBe(2);
  reads = 0;
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 500 }), [closure])).toThrow(
    SandboxError
  );
});

it("preserves registered weak contributions on SDK-owned closures", () => {
  const collection = createWeakCollection("map");
  const key = {};
  setWeakEntry(collection, key, { text: "x".repeat(1000) });
  const state = weakCollectionStates.get(collection);
  if (state === undefined) throw new Error("Expected weak collection state");
  const closure = createSandboxClosure({ call: () => undefined });
  weakCollectionStates.set(closure, state);
  expect(measureSandboxData([closure, key])).toBe(1009);
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 500 }), [closure, key])).toThrow(
    SandboxError
  );
});

it("preserves module namespace roots registered on a closure", () => {
  const payload = { text: "small" };
  const closure = createSandboxClosure({ call: () => undefined });
  moduleNamespaceRetainedValues.set(closure, () => [payload]);
  const before = measureSandboxData([closure]);
  payload.text = "x".repeat(1005);
  expect(measureSandboxData([closure]) - before).toBe(1000);
});

it("retains dynamic source links before owned closure inspection", () => {
  const closure = createSandboxClosure({ call: () => undefined });
  const source: DynamicSource = { kind: "normal", parameters: "", body: "small", nodes: new Map() };
  dynamicSourceRecords.add(source);
  dynamicValueSources.set(closure, source);
  const before = measureSandboxData([closure]);
  source.body = "x".repeat(1005);
  expect(measureSandboxData([closure]) - before).toBe(1000);
});
