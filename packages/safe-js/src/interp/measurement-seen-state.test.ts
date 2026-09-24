import { expect, it } from "vitest";
import { createSandboxClosure, measureSandboxData, type SandboxObject } from "./values.js";
import { withMeasurementSeen } from "./measurement-seen.js";

it("keeps invalid keys and misses false before and after repeated positive lookups", () => {
  withMeasurementSeen(seen => {
    const value = {};
    const misses = [undefined, null, false, 0, "", Symbol("missing"), value];
    for (const miss of misses) expect(seen.has(miss as object)).toBe(false);
    seen.add(value);
    for (let index = 0; index < 10; index++) expect(seen.has(value)).toBe(true);
    for (const miss of misses.slice(0, -1)) expect(seen.has(miss as object)).toBe(false);
    const later = {};
    expect(seen.has(later)).toBe(false);
    seen.add(later);
    expect(seen.has(later)).toBe(true);
  });
});

it("does not reuse completed-walk hits when a later walk changes generation marks", () => {
  const value = {};
  const previous = withMeasurementSeen(seen => {
    seen.add(value);
    expect(seen.has(value)).toBe(true);
    return seen;
  });
  expect(previous.has(value)).toBe(true);
  withMeasurementSeen(seen => {
    expect(seen.has(value)).toBe(false);
    seen.add(value);
    expect(seen.has(value)).toBe(true);
    expect(previous.has(value)).toBe(false);
  });
});

it("observes writes through an old walk handle during a later active walk", () => {
  const value = {};
  const previous = withMeasurementSeen(seen => seen);
  withMeasurementSeen(seen => {
    seen.add(value);
    expect(seen.has(value)).toBe(true);
    withMeasurementSeen(() => previous.add(value));
    expect(seen.has(value)).toBe(false);
    seen.add(value);
    expect(seen.has(value)).toBe(true);
  });
});

it("keeps positive lookups independent across nested walks and wide working sets", () => {
  const values = Array.from({ length: 20 }, () => ({}));
  withMeasurementSeen(outer => {
    for (const value of values) outer.add(value);
    for (const value of values) expect(outer.has(value)).toBe(true);
    withMeasurementSeen(inner => {
      for (const value of values) expect(inner.has(value)).toBe(false);
      for (const value of values) inner.add(value);
      for (const value of values) expect(inner.has(value)).toBe(true);
    });
    for (const value of values) expect(outer.has(value)).toBe(true);
  });
});

it("does not expose private visited state to later native WeakSet hooks", () => {
  const child = { text: "x".repeat(1000) };
  const root = { child };
  const before = measureSandboxData([root]);
  const Constructor = globalThis.WeakSet;
  const original = Constructor.prototype.has;
  const add = Constructor.prototype.add;
  let visited: WeakSet<object> | undefined;
  globalThis.WeakSet = new Proxy(Constructor, {
    construct(target, args) {
      visited = Reflect.construct(target, args) as WeakSet<object>;
      return visited;
    }
  });
  let after = -1;
  Constructor.prototype.has = function (value: object) {
    if (this === visited && value === root) add.call(this, child);
    return original.call(this, value);
  };
  try {
    after = measureSandboxData([root]);
  } finally {
    Constructor.prototype.has = original;
    globalThis.WeakSet = Constructor;
  }
  expect(after).toBe(before);
});

it("remeasures cycles and changed descendants on every fresh walk", () => {
  const child = { text: "old" };
  const root: { child: typeof child; self?: unknown } = { child };
  root.self = root;
  const before = measureSandboxData([root, root]);
  expect(measureSandboxData([root])).toBe(before);
  child.text = "x".repeat(1003);
  expect(measureSandboxData([root, root])).toBe(before + 1000);
  expect(measureSandboxData([root])).toBe(before + 1000);
});

it("pins weak registry operations without revealing numeric visit markers", () => {
  const root = { text: "x".repeat(1000) };
  const before = measureSandboxData([root]);
  const get = WeakMap.prototype.get;
  const set = WeakMap.prototype.set;
  let markers = 0;
  WeakMap.prototype.get = function (key: object) {
    const value = get.call(this, key);
    if (key === root && typeof value === "number") markers++;
    return value;
  };
  WeakMap.prototype.set = function (key: object, value: unknown) {
    if (key === root && typeof value === "number") markers++;
    return set.call(this, key, value);
  };
  let after = -1;
  try {
    after = measureSandboxData([root]);
  } finally {
    WeakMap.prototype.get = get;
    WeakMap.prototype.set = set;
  }
  expect(after).toBe(before);
  expect(markers).toBe(0);
});

it("keeps outer visited identities intact across reentrant walks", () => {
  const root: SandboxObject = {};
  let nested = -1;
  const closure = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      nested = measureSandboxData([root], { ignoreClosureCaptures: true });
      return [root];
    }
  });
  root.callback = closure;
  const expected = measureSandboxData([root], { ignoreClosureCaptures: true });
  expect(measureSandboxData([root])).toBe(expected);
  expect(nested).toBe(expected);
  expect(measureSandboxData([root])).toBe(expected);
});

it("releases walk state when a retained provider throws", () => {
  const error = new Error("provider failed");
  const closure = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      throw error;
    }
  });
  const child = { text: "old" };
  const before = measureSandboxData([child]);
  expect(() => measureSandboxData([closure])).toThrow(error);
  expect(measureSandboxData([child])).toBe(before);
  child.text = "x".repeat(1003);
  expect(measureSandboxData([child])).toBe(before + 1000);
});

it("does not reveal private marker registries through inherited storage setters", () => {
  const child = { text: "x".repeat(1000) };
  const exposed: WeakMap<object, number>[] = [];
  Object.defineProperty(Object.prototype, "store", {
    configurable: true,
    set(value: WeakMap<object, number>) {
      exposed.push(value);
      Object.defineProperty(this, "store", { value, writable: true, configurable: true });
    }
  });
  let usage = -1;
  try {
    usage = measureSandboxData([child]);
  } finally {
    Reflect.deleteProperty(Object.prototype, "store");
  }
  expect(usage).toBe(1006);
  expect(exposed).toHaveLength(0);
});
