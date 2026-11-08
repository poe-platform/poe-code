import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { markDescriptorObject } from "./object-model.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["dense", "sparse", "proxy", "managed"])(
  "keeps %s array snapshots private from later native push hooks",
  (kind) => {
    const payload = { text: "x".repeat(1000) };
    let owner: unknown[] = kind === "sparse" ? new Array(3) : [];
    owner[kind === "sparse" ? 2 : 0] = payload;
    if (kind === "managed") markDescriptorObject(owner);
    if (kind === "proxy") owner = new Proxy(owner, { ownKeys: () => ["length"] });
    const expected = measureSandboxData([owner]);
    const push = Array.prototype.push;
    let exposed = 0;
    let actual = -1;
    let rejected = false;
    Array.prototype.push = function (...items: unknown[]) {
      if (items.some(item => item === payload ||
          (Array.isArray(item) && item[1]?.value === payload))) {
        exposed++;
        return this.length;
      }
      return Reflect.apply(push, this, items);
    };
    try {
      actual = measureSandboxData([owner]);
      try {
        reconcileCompiledValues(new Budget({ dataSize: 500 }), [owner]);
      } catch (error) {
        rejected = (error as { budget?: string }).budget === "dataSize";
      }
    } finally {
      Array.prototype.push = push;
    }
    expect(actual).toBe(expected);
    expect(exposed).toBe(0);
    expect(rejected).toBe(true);
  }
);

it.each([false, true])("bypasses inherited native snapshot index setters (managed=%s)", managed => {
  const payload = { text: "x".repeat(1000) };
  const owner = [payload];
  if (managed) markDescriptorObject(owner);
  const expected = measureSandboxData([owner]);
  const define = Object.defineProperty;
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  let actual = -1;
  define(Array.prototype, "0", {
    configurable: true,
    set(value: unknown) {
      const snapshot = value === payload ||
        (Array.isArray(value) && value[1]?.value === payload);
      if (snapshot) exposed++;
      define(this, "0", { value: snapshot ? undefined : value, writable: true,
        enumerable: true, configurable: true });
    }
  });
  try {
    actual = measureSandboxData([owner]);
  } finally {
    if (original === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else define(Array.prototype, "0", original);
  }
  expect(actual).toBe(expected);
  expect(exposed).toBe(0);
});

it("does not expose array continuation frames through inherited index setters", () => {
  const owner = [{ text: "x".repeat(1000) }, { text: "y".repeat(2000) }];
  const expected = measureSandboxData([owner]);
  const define = Object.defineProperty;
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  let actual = -1;
  define(Array.prototype, "0", {
    configurable: true,
    set(value: unknown) {
      const frame = typeof value === "object" && value !== null && Object.hasOwn(value, "values") && Object.hasOwn(value, "depth");
      if (frame) exposed++;
      define(this, "0", { value: frame ? { values: [], index: 1, depth: 0 } : value,
        writable: true, enumerable: true, configurable: true });
    }
  });
  try {
    actual = measureSandboxData([owner]);
  } finally {
    if (original === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else define(Array.prototype, "0", original);
  }
  expect(actual).toBe(expected);
  expect(exposed).toBe(0);
});

it("uses indexed reads for private managed descriptor tuples", () => {
  const payload = { text: "x".repeat(1000) };
  const owner = [payload];
  markDescriptorObject(owner);
  const expected = measureSandboxData([owner]);
  const iterator = Array.prototype[Symbol.iterator];
  let exposed = 0;
  let actual = -1;
  Array.prototype[Symbol.iterator] = function () {
    if (this[0] === "0" && this[1]?.value === payload) {
      exposed++;
      return Reflect.apply(iterator, [], []);
    }
    return Reflect.apply(iterator, this, []);
  };
  try {
    actual = measureSandboxData([owner]);
  } finally {
    Array.prototype[Symbol.iterator] = iterator;
  }
  expect(actual).toBe(expected);
  expect(exposed).toBe(0);
});
