import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { resolveIntrinsicIdentity } from "./intrinsics.js";
import { releaseObjectPrototype } from "./object-model.js";
import { measureSandboxData, type SandboxObject } from "./values.js";

const paths = [
  ...["Object", "Date", "DataView", "RegExp", "Map", "Set", "ArrayBuffer",
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
    target.extra = {text: "abc"};
    const before = measureSandboxData(budget.retainedValues());
    const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
    try {
      expect(measureSandboxData(budget.retainedValues())).toBe(before);
      expect(descriptors.mock.calls.filter(([owner]) => owner === target)).toHaveLength(0);
    } finally { descriptors.mockRestore(); }
    (target.extra as SandboxObject).text = "abcdef";
    expect(measureSandboxData(budget.retainedValues())).toBe(before + 3);
    delete target.extra;
    expect([...budget.retainedValues()]).not.toContain("extra");
    const key = Symbol("new property");
    Object.defineProperty(target, key, {value: "hidden", configurable: true});
    expect([...budget.retainedValues()]).toContain("hidden");
    Reflect.deleteProperty(target, key);
    expect([...budget.retainedValues()]).not.toContain("hidden");
  } finally { releaseObjectPrototype(budget); }
});
