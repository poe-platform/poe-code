import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { resolveIntrinsicIdentity } from "./intrinsics.js";
import { releaseObjectPrototype } from "./object-model.js";
import { measureSandboxData, type SandboxArray, type SandboxObject } from "./values.js";

const paths = [
  ...["Object", "Array", "Symbol", "BigInt", "String", "Number", "Boolean", "Date", "DataView", "RegExp", "Map", "Set", "ArrayBuffer",
    "DisposableStack", "AsyncDisposableStack", "Error", "TypeError", "RangeError",
    "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError",
    "SuppressedError", "Promise"].map(name => [name, "prototype"]),
  ...["JSON", "Reflect", "%IteratorPrototype%", "%IteratorHelperPrototype%",
    "%GeneratorPrototype%", "%AsyncGeneratorPrototype%", "%GeneratorFunctionPrototype%",
    "%AsyncGeneratorFunctionPrototype%", "%ArrayIteratorPrototype%",
    "%StringIteratorPrototype%", "%WrapForValidIteratorPrototype%",
    "%MapIteratorPrototype%", "%SetIteratorPrototype%", "%RegExpStringIteratorPrototype%",
    "%AsyncIteratorPrototype%"].map(name => [name])
];

it.each(paths.map(path => [JSON.stringify(path)]))("reuses captures for %s while observing mutations", id => {
  const budget = new Budget();
  createBuiltinBindings({budget});
  const target = resolveIntrinsicIdentity(budget, id) as SandboxObject;
  try {
    const baseline = measureSandboxData(budget.retainedValues());
    target.extra = {text: "abc"};
    const before = measureSandboxData(budget.retainedValues());
    const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
    try {
      expect(measureSandboxData(budget.retainedValues())).toBe(before);
      expect(descriptors.mock.calls.filter(([owner]) => owner === target).length).toBe(0);
    } finally { descriptors.mockRestore(); }
    (target.extra as SandboxObject).text = "abcdef";
    expect(measureSandboxData(budget.retainedValues())).toBe(before + 3);
    delete target.extra;
    expect(measureSandboxData(budget.retainedValues())).toBe(baseline);
    const key = Symbol("new property");
    Object.defineProperty(target, key, {value: "hidden", configurable: true});
    expect(measureSandboxData(budget.retainedValues())).toBe(baseline + measureSandboxData([key, "hidden"]));
    Reflect.deleteProperty(target, key);
    expect(measureSandboxData(budget.retainedValues())).toBe(baseline);
  } finally { releaseObjectPrototype(budget); }
});

it("refreshes Array prototype captures after a partially rejected length shrink", () => {
  const budget = new Budget();
  createBuiltinBindings({budget});
  const target = resolveIntrinsicIdentity(budget, '["Array","prototype"]') as SandboxArray;
  const kept = {text: "kept"};
  const removed = {text: "removed"};
  try {
    expect(Array.isArray(target)).toBe(true);
    Object.defineProperty(target, "1", {value: kept, configurable: false});
    target[2] = removed;
    expect([...budget.retainedValues()]).toContain(removed);
    expect(Reflect.defineProperty(target, "length", {value: 0})).toBe(false);
    expect(target.length).toBe(2);
    const roots = [...budget.retainedValues()];
    expect(roots).toContain(kept);
    expect(roots).not.toContain(removed);
    const before = measureSandboxData(budget.retainedValues());
    kept.text += "more";
    expect(measureSandboxData(budget.retainedValues())).toBe(before + 4);
  } finally { releaseObjectPrototype(budget); }
});
