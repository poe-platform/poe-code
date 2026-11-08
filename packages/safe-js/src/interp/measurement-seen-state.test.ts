import { expect, it } from "vitest";
import { createSandboxClosure, measureSandboxData, type SandboxObject } from "./values.js";

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
