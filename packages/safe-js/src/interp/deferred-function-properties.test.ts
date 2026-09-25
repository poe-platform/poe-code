import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { setImmediate } from "node:timers/promises";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { encodeReplayData } from "../snapshot/replay-data.js";
import { restoreSandboxArrayIterator } from "./array-iterator.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import {
  deferFunctionProperties,
  hasGuestObjectState,
  materializeFunctionProperties
} from "./object-model.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

function method(retainedValues?: () => Iterable<SandboxValue>) {
  const value = createSandboxClosure({
    guest: true,
    sandbox: true,
    name: "read",
    length: 2,
    call: () => undefined,
    retainedValues
  });
  expect(deferFunctionProperties(value)).toBe(true);
  return value;
}

it("recognizes reserved function properties as guest state before reflection", () => {
  const value = method();
  expect(hasGuestObjectState(value)).toBe(true);
  materializeFunctionProperties(value);
  expect(hasGuestObjectState(value)).toBe(true);
});

it("keeps unobserved class method properties out of capability-only replay", () => {
  const value = method();
  expect(() => encodeReplayData(value, { identifyCapability: () => "method" })).toThrow(
    "Guest function properties and prototype links cannot be serialized."
  );
});

it("charges the same default property table before and after reflection materializes it", () => {
  const value = method();
  const eager = createSandboxClosure({
    guest: true,
    sandbox: true,
    name: "read",
    length: 2,
    call: () => undefined
  });
  materializeFunctionProperties(eager);
  const before = measureSandboxData([eager]);
  expect(before).toBe(18);
  expect(measureSandboxData([value])).toBe(before);
  const properties = value.properties!;
  expect(Object.getOwnPropertyDescriptors(properties)).toEqual({
    length: { value: 2, configurable: true, enumerable: false, writable: false },
    name: { value: "read", configurable: true, enumerable: false, writable: false }
  });
  expect(value.properties).toBe(properties);
  expect(measureSandboxData([value, properties])).toBe(before);
  Object.defineProperty(properties, "name", { value: "x".repeat(1004) });
  expect(measureSandboxData([properties, value])).toBe(before + 1000);
  Reflect.deleteProperty(properties, "name");
  expect(measureSandboxData([value])).toBe(9);
});

it.each([false, true])("reconciles a table materialized by a later collector (held=%s)", (held) => {
  let mutate = false;
  const value = method();
  const observer = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (mutate) value.properties!.payload = "x".repeat(1000);
      return [];
    }
  });
  const before = measureSandboxData([value, observer]);
  const budget = new Budget({ dataSize: before + 100 });
  const release = held ? budget.deferReconciliation() : undefined;
  mutate = true;
  try {
    expect(() => reconcileCompiledValues(budget, [value, observer])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
    expect(measureSandboxData([value, observer])).toBe(before + 1008);
  } finally {
    release?.();
  }
});

it("preserves table mutations during its own closure collector and reentrant accounting", () => {
  let mutate = false;
  let nested = 0;
  const value = method(() => {
    if (mutate) {
      mutate = false;
      value.properties!.payload = { text: "nested" };
      nested = measureSandboxData([value], { ignoreClosureCaptures: true });
    }
    return [];
  });
  const before = measureSandboxData([value]);
  mutate = true;
  const after = measureSandboxData([value]);
  expect(after).toBe(before + 20);
  expect(nested).toBe(after);
  expect(measureSandboxData([value, value.properties])).toBe(after);
});

it("preserves the property table depth boundary before materialization", () => {
  const value = method();
  let root: SandboxValue = value;
  for (let i = 0; i < MAX_DATA_DEPTH; i++) root = { next: root };
  expect(() => measureSandboxData([root])).toThrow(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
  );
  materializeFunctionProperties(value);
  expect(() => measureSandboxData([root])).toThrow(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
  );
});

it("keeps constructors and already materialized tables on their ordinary path", () => {
  const constructor = createSandboxClosure({
    guest: true,
    call: () => undefined,
    construct: () => ({})
  });
  expect(deferFunctionProperties(constructor)).toBe(false);
  const value = createSandboxClosure({ guest: true, call: () => undefined });
  const properties = materializeFunctionProperties(value);
  expect(deferFunctionProperties(value)).toBe(false);
  expect(value.properties).toBe(properties);
});

it("enforces the original data quota before a table is observed", () => {
  const value = method();
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 18 }), [value])).not.toThrow();
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 17 }), [value])).toThrow(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
  );
});

it("visits runtime state attached to a materialized scalar property table", () => {
  const value = method();
  const before = measureSandboxData([value]);
  const payload = { text: "x".repeat(1000) };
  restoreSandboxArrayIterator({ source: payload, index: 0, method: "keys" }, value.properties!);
  expect(measureSandboxData([value])).toBe(before + measureSandboxData([payload]));
  payload.text = "x".repeat(2000);
  expect(measureSandboxData([value, value.properties, payload])).toBe(
    before + measureSandboxData([payload])
  );
});

it("preserves both native property-table observations after materialization", () => {
  const value = method();
  const nativeGet = WeakMap.prototype.get;
  const table: { value?: WeakMap<object, unknown> } = {};
  let reads = 0;
  const spy = vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
    this: WeakMap<object, unknown>,
    key: object
  ) {
    if (key === value) table.value = this;
    return nativeGet.call(this, key);
  });
  void value.properties;
  spy.mockRestore();
  expect(table.value).toBeDefined();
  const retained = { text: "x".repeat(1000) };
  const observe = vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
    this: WeakMap<object, unknown>,
    key: object
  ) {
    if (this === table.value && key === value) return ++reads === 1 ? {} : retained;
    return nativeGet.call(this, key);
  });
  let charge: number;
  try {
    charge = measureSandboxData([value]);
  } finally {
    observe.mockRestore();
  }
  expect(reads).toBe(2);
  expect(charge).toBe(1007);
});

it.each([false, true])(
  "restores class method descriptors and aliases (observed=%s)",
  async (observed) => {
    const source = `class C {
    read(a, b) { return a + b; }
    get value() { return 7; }
    static async named(v) { return v; }
    *sequence() { yield 9; }
  }
  const read = C.prototype.read;
  const getter = Object.getOwnPropertyDescriptor(C.prototype, "value").get;
  ${observed ? 'Object.defineProperty(read, "name", {value: "changed"}); read.extra = "retained";' : ""}
  await 0;
  const descriptor = Object.getOwnPropertyDescriptor(read, "name");
  return [read === C.prototype.read, read.name, read.length, read(2, 3),
    descriptor.writable, descriptor.enumerable, descriptor.configurable,
    getter.name, new C().value, C.named.name, await C.named(8),
    C.prototype.sequence.name, new C().sequence().next().value, read.extra];`;
    const pending = run(source);
    const completed = pending.catch((error) => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = [
        true,
        observed ? "changed" : "read",
        2,
        5,
        false,
        false,
        true,
        "get value",
        7,
        "named",
        8,
        "sequence",
        9,
        observed ? "retained" : undefined
      ];
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally {
      await completed;
    }
  }
);

function discardedMethod(materialized: boolean, fails: boolean) {
  const value = method(() => {
    if (fails) throw new Error("collector failed");
    return [];
  });
  const properties = materialized ? value.properties : undefined;
  if (fails) expect(() => measureSandboxData([value])).toThrow("collector failed");
  else measureSandboxData([value]);
  return {
    value: new WeakRef(value),
    properties: properties ? new WeakRef(properties) : undefined
  };
}

it.skipIf(typeof global.gc !== "function").each([
  [false, false],
  [true, false],
  [false, true],
  [true, true]
])(
  "releases deferred property state after measurement (materialized=%s, fails=%s)",
  async (materialized, fails) => {
    const references = discardedMethod(materialized, fails);
    for (let i = 0; i < 8; i++) {
      await setImmediate();
      global.gc!();
    }
    expect(references.value.deref()).toBeUndefined();
    expect(references.properties?.deref()).toBeUndefined();
  }
);
