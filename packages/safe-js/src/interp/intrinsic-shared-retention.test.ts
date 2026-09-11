import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { getSandboxDataProperty, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, releaseObjectPrototype } from "./object-model.js";
import { createBuiltinBindings } from "./globals.js";

it.each(["function-first", "object-first"])("counts one mutated function once across %s registrations", order => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, sandbox: true, name: "method", call: () => undefined });
  const properties = materializeFunctionProperties(method);
  const root = { method };
  if (order === "function-first") registerIntrinsicFunction(budget, method);
  registerIntrinsicObject(budget, root);
  if (order === "object-first") registerIntrinsicFunction(budget, method);
  try {
    properties.probe = "x";
    expect([...budget.retainedValues()]).toEqual(["probe", "x"]);
    expect(measureSandboxData(budget.retainedValues())).toBe(6);
    properties.probe = "longer";
    expect(measureSandboxData(budget.retainedValues())).toBe(11);
    delete properties.probe;
    expect(measureSandboxData(budget.retainedValues())).toBe(0);
  } finally { releaseObjectPrototype(budget); }
});

it("does not merge equal primitive properties owned by different functions", () => {
  const budget = new Budget();
  const first = createSandboxClosure({ guest: true, sandbox: true, name: "first", call: () => undefined });
  const second = createSandboxClosure({ guest: true, sandbox: true, name: "second", call: () => undefined });
  registerIntrinsicObject(budget, { first, second });
  try {
    materializeFunctionProperties(first).probe = "x";
    materializeFunctionProperties(second).probe = "x";
    expect(measureSandboxData(budget.retainedValues())).toBe(12);
  } finally { releaseObjectPrototype(budget); }
});

it("retains the initial baseline when an existing function is registered through a later namespace", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, sandbox: true, name: "method", call: () => undefined });
  registerIntrinsicFunction(budget, method);
  const properties = materializeFunctionProperties(method);
  properties.probe = "x";
  registerIntrinsicObject(budget, { method });
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(6);
    properties.probe = "longer";
    expect(measureSandboxData(budget.retainedValues())).toBe(11);
  } finally { releaseObjectPrototype(budget); }
});

it("keeps retained state when the same root is registered again", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, sandbox: true, name: "method", call: () => undefined });
  registerIntrinsicFunction(budget, method);
  materializeFunctionProperties(method).probe = "x";
  registerIntrinsicFunction(budget, method);
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(6);
  } finally { releaseObjectPrototype(budget); }
  expect([...budget.retainedValues()]).toEqual([]);
});

it("tracks the same target independently in separate budgets", () => {
  const first = new Budget();
  const second = new Budget();
  const method = createSandboxClosure({ guest: true, sandbox: true, name: "method", call: () => undefined });
  registerIntrinsicFunction(first, method);
  registerIntrinsicFunction(second, method);
  try {
    materializeFunctionProperties(method).probe = "x";
    expect(measureSandboxData(first.retainedValues())).toBe(6);
    expect(measureSandboxData(second.retainedValues())).toBe(6);
    releaseObjectPrototype(first);
    expect(measureSandboxData(second.retainedValues())).toBe(6);
  } finally { releaseObjectPrototype(first); releaseObjectPrototype(second); }
});

it.each([["Intl", "Locale"], ["Intl", "getCanonicalLocales"], ["Math", "abs"]] as const)("charges %s.%s once after builtin installation", (namespace, name) => {
  const budget = new Budget();
  const bindings = createBuiltinBindings({ budget });
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(0);
    const method = getSandboxDataProperty(bindings[namespace], name, budget);
    if (!isSandboxClosure(method)) throw new Error("Missing intrinsic method");
    materializeFunctionProperties(method).probe = "x";
    expect(measureSandboxData(budget.retainedValues())).toBe(6);
  } finally { releaseObjectPrototype(budget); }
});
