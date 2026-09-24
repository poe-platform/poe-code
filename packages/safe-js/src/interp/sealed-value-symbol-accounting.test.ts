import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { internalSymbols } from "./internal-symbols.js";
import {
  createSandboxMap,
  createSandboxPromise,
  createSandboxRegex,
  createSandboxSet,
  getCollectionProperties,
  getPromiseProperties,
  getRegexProperties,
  measureSandboxData,
  reconcileCompiledValues
} from "./values.js";

const factories = [
  {
    name: "Map",
    create: () => {
      const value = createSandboxMap();
      return { value, properties: getCollectionProperties(value) };
    }
  },
  {
    name: "Set",
    create: () => {
      const value = createSandboxSet();
      return { value, properties: getCollectionProperties(value) };
    }
  },
  {
    name: "Promise",
    create: () => {
      const value = createSandboxPromise(new Promise(() => undefined), { trackReplay: false });
      return { value, properties: getPromiseProperties(value) };
    }
  },
  {
    name: "RegExp",
    create: () => {
      const value = createSandboxRegex("a");
      return { value, properties: getRegexProperties(value) };
    }
  }
];

it.each(factories)("reuses $name carrier symbol keys across measurements", ({ create }) => {
  const { value } = create();
  const before = measureSandboxData([value]);
  const symbols = vi.spyOn(Object, "getOwnPropertySymbols");
  let after: number, reads: number;
  try {
    after = measureSandboxData([value]);
    reads = symbols.mock.calls.filter(([owner]) => owner === value).length;
  } finally {
    symbols.mockRestore();
  }
  expect(after).toBe(before);
  expect(reads).toBe(0);
});

it.each(factories)("still observes internal-symbol membership for $name", ({ create }) => {
  const { value } = create();
  const key = Object.getOwnPropertySymbols(value).find((symbol) => internalSymbols.has(symbol))!;
  expect(key).toBeDefined();
  const before = measureSandboxData([value]);
  internalSymbols.delete(key);
  try {
    expect(measureSandboxData([value])).toBeGreaterThan(before);
  } finally {
    internalSymbols.add(key);
  }
  expect(measureSandboxData([value])).toBe(before);
});

it.each(factories)(
  "keeps $name guest symbols, descendants, aliases and quotas live",
  ({ create }) => {
    const { value, properties } = create();
    const child = { text: "small" };
    properties.child = child;
    const before = measureSandboxData([value]);
    const key = Symbol("guest field");
    Object.defineProperty(properties, key, { value: child, configurable: true });
    const added = measureSandboxData([value]);
    expect(added).toBeGreaterThan(before);
    expect(measureSandboxData([value, child])).toBe(added);
    child.text = "x".repeat(1005);
    expect(measureSandboxData([value])).toBe(added + 1000);
    for (const held of [false, true]) {
      const budget = new Budget({ dataSize: added + 500 });
      const release = held ? budget.deferReconciliation() : undefined;
      try {
        expect(() => reconcileCompiledValues(budget, [value])).toThrow(
          expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
        );
      } finally {
        release?.();
      }
    }
    Reflect.deleteProperty(properties, key);
    child.text = "small";
    expect(measureSandboxData([value])).toBe(before);
  }
);

it("reads immutable carrier descriptors afresh after capturing their keys", () => {
  const { value } = factories[2]!.create();
  const before = measureSandboxData([value]);
  const original = Object.getOwnPropertyDescriptor;
  const read = vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((owner, key) => {
    const descriptor = original(owner, key);
    return owner === value && key === Symbol.toStringTag
      ? { ...descriptor, value: "x".repeat(1007) }
      : descriptor;
  });
  try {
    expect(measureSandboxData([value])).toBe(before + 1000);
  } finally {
    read.mockRestore();
  }
});

it("keeps foreign sealed objects on the observable symbol-enumeration path", () => {
  const value = Object.seal({ [Symbol("native")]: "payload" });
  const before = measureSandboxData([value]);
  const symbols = vi.spyOn(Object, "getOwnPropertySymbols");
  try {
    expect(measureSandboxData([value])).toBe(before);
    expect(symbols.mock.calls.filter(([owner]) => owner === value)).toHaveLength(1);
  } finally {
    symbols.mockRestore();
  }
});

it("captures construction-time symbols without exposing the private key vector", () => {
  const key = Symbol("extra carrier data");
  const child = { text: "small" };
  const define = Object.defineProperties;
  const inject = vi.spyOn(Object, "defineProperties").mockImplementation((value, descriptors) => {
    if (descriptors.kind?.value === "map") Object.defineProperty(value, key, { value: child });
    return define(value, descriptors);
  });
  let value: ReturnType<typeof createSandboxMap>;
  try {
    value = createSandboxMap();
  } finally {
    inject.mockRestore();
  }
  const before = measureSandboxData([value]);
  const iterate = Array.prototype[Symbol.iterator];
  let exposed = false,
    after: number;
  Array.prototype[Symbol.iterator] = function () {
    if (this.includes(key)) exposed = true;
    return iterate.call(this);
  };
  try {
    child.text = "x".repeat(1005);
    after = measureSandboxData([value]);
  } finally {
    Array.prototype[Symbol.iterator] = iterate;
  }
  expect(exposed).toBe(false);
  expect(after).toBe(before + 1000);
  expect(measureSandboxData([value, child])).toBe(after);
});

it("observes collection mutations, RegExp state and later Promise settlement", async () => {
  const map = createSandboxMap(),
    set = createSandboxSet(),
    regex = createSandboxRegex("a");
  let resolve!: (value: { text: string }) => void;
  const promise = createSandboxPromise(
    new Promise((done) => {
      resolve = done;
    }),
    { trackReplay: false }
  );
  const roots = [map, set, regex, promise];
  const before = measureSandboxData(roots);
  const child = { text: "small" };
  map.entries.set("child", child);
  set.values.add(child);
  regex.lastIndex = child;
  resolve(child);
  await promise.promise;
  const settled = measureSandboxData(roots);
  expect(settled).toBeGreaterThan(before);
  child.text = "x".repeat(1005);
  expect(measureSandboxData(roots)).toBe(settled + 1000);
  expect(measureSandboxData([...roots, child])).toBe(settled + 1000);
});

it.each(factories)("pins $name finalization before trusting its symbol keys", ({ create }) => {
  const freeze = vi.spyOn(Object, "freeze").mockImplementation((value) => value);
  const seal = vi.spyOn(Object, "seal").mockImplementation((value) => value);
  let value: ReturnType<typeof create>["value"];
  try {
    value = create().value;
  } finally {
    freeze.mockRestore();
    seal.mockRestore();
  }
  expect(Object.isSealed(value)).toBe(true);
  expect(Reflect.defineProperty(value, Symbol("late"), { value: "payload" })).toBe(false);
});
