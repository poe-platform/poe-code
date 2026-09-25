import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { Scope, visitScopeDataRoots } from "./scope.js";
import { measureSandboxData } from "./values.js";

it("captures deep lexical ancestry without consuming the native call stack", () => {
  let scope = new Scope({ ancestor: "charged" });
  for (let index = 0; index < 32768; index++) scope = scope.child();
  scope.declare("leaf", "const", "leaf");
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(11);
});

it("preserves ancestor order and pending children across nested captures", () => {
  const order: string[] = [];
  const root = new Scope({ root: "root" });
  const middle = root.child({ middle: "middle" });
  const leaf = middle.child({ leaf: "leaf" });
  const nested = new Scope({ nested: "nested" }).child().child();
  Object.defineProperty(root, "importMeta", { get() {
    order.push("root");
    expect(measureSandboxData(nested.retainedDataRoots())).toBe(6);
    return undefined;
  } });
  Object.defineProperty(middle, "importMeta", { get() { order.push("middle"); return undefined; } });
  Object.defineProperty(leaf, "importMeta", { get() { order.push("leaf"); return undefined; } });
  const charges: number[] = [];
  visitScopeDataRoots(leaf, value => charges.push(measureSandboxData([value])));
  expect(order).toEqual(["root", "middle", "leaf"]);
  expect(charges).toEqual([4, 6, 4]);
});

it("observes foreign collectors and their child mutations on every capture", () => {
  const root = new Scope();
  const leaf = root.child();
  leaf.declare("text", "let", "before");
  let calls = 0;
  root.retainedDataRoots = () => {
    calls++;
    leaf.assign("text", "x".repeat(calls));
    return ["foreign"];
  };
  expect(measureSandboxData(leaf.retainedDataRoots())).toBe(8);
  expect(measureSandboxData(leaf.retainedDataRoots())).toBe(9);
  expect(calls).toBe(2);
});

it("keeps already-read ancestor links stable until the next capture", () => {
  const root = new Scope({ old: "old" });
  const middle = root.child({ middle: "middle" });
  const leaf = middle.child({ leaf: "leaf" });
  const replacement = new Scope({ next: "replacement" });
  Object.defineProperty(root, "importMeta", { get() {
    Object.defineProperty(middle, "parent", { value: replacement });
    return undefined;
  } });
  expect(measureSandboxData(leaf.retainedDataRoots())).toBe(13);
  expect(measureSandboxData(leaf.retainedDataRoots())).toBe(21);
});

it("unwinds failed parent and append callbacks before another capture", () => {
  const failure = new Error("capture failed");
  const root = new Scope({ hidden: "hidden" });
  const leaf = root.child({ child: "child" }).child();
  Object.defineProperty(root, "importMeta", { configurable: true, get() { throw failure; } });
  expect(() => leaf.retainedDataRoots()).toThrow(failure);
  Reflect.deleteProperty(root, "importMeta");
  expect(() => visitScopeDataRoots(leaf, () => { throw failure; })).toThrow(failure);
  expect(measureSandboxData(new Scope({ clean: "ok" }).retainedDataRoots())).toBe(2);
  expect(measureSandboxData(leaf.retainedDataRoots())).toBe(11);
});

it("fails on cyclic native ancestry and recovers after it is repaired", () => {
  const root = new Scope({ text: "charged" });
  const leaf = root.child();
  Object.defineProperty(root, "parent", { configurable: true, value: leaf });
  expect(() => leaf.retainedDataRoots()).toThrow(RangeError);
  Object.defineProperty(root, "parent", { value: undefined });
  expect(measureSandboxData(leaf.retainedDataRoots())).toBe(7);
});

it("does not expose ancestor storage through later native array hooks", () => {
  const scope = new Scope({ text: "charged" }).child().child();
  const push = Array.prototype.push;
  const prior = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  const output: unknown[] = [];
  Array.prototype.push = function (...values: unknown[]) {
    if (values.some(value => value instanceof Scope)) exposed++;
    return push.apply(this, values);
  };
  Object.defineProperty(Array.prototype, "0", { configurable: true, set(value: unknown) {
    if (value instanceof Scope) exposed++;
    Object.defineProperty(this, "0", { value, configurable: true, writable: true, enumerable: true });
  } });
  try {
    visitScopeDataRoots(scope, value => push.call(output, value));
  } finally {
    Array.prototype.push = push;
    if (prior === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else Object.defineProperty(Array.prototype, "0", prior);
  }
  expect(exposed).toBe(0);
  expect(measureSandboxData(output)).toBe(7);
});

it.skipIf(typeof global.gc !== "function").each([false, true])(
  "releases captured ancestors after traversal (throws: %s)", async (throws) => {
    const remember = () => {
      const root = new Scope({ text: "x".repeat(1000) });
      const leaf = root.child().child();
      const reference = new WeakRef(leaf);
      if (throws) {
        Object.defineProperty(root, "importMeta", { get() { throw new Error("failed"); } });
        expect(() => leaf.retainedDataRoots()).toThrow("failed");
      } else expect(measureSandboxData(leaf.retainedDataRoots())).toBe(1000);
      return reference;
    };
    const reference = remember();
    for (let index = 0; index < 8; index++) { await setImmediate(); global.gc!(); }
    expect(reference.deref()).toBeUndefined();
  }
);
