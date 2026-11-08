import { expect, it, vi } from "vitest";
import { accessorAdapter } from "./accessors.js";
import { createSandboxArguments } from "./arguments.js";
import { Budget } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import { createSandboxClosure, createSandboxRegex, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["get", "set"] as const)("measures retained arguments %s captures without invoking them", kind => {
  const call = vi.fn(() => undefined);
  const small = createSandboxArguments([]);
  const large = createSandboxArguments([]);
  for (const [target, payload] of [[small, ""], [large, "x".repeat(100)]] as const) {
    const closure = createSandboxClosure({ guest: true, call, retainedValues: () => [payload] });
    Object.defineProperty(target, "hidden", { [kind]: accessorAdapter(closure, kind), configurable: true });
  }
  expect(measureSandboxData([large]) - measureSandboxData([small])).toBe(100);
  expect(call).not.toHaveBeenCalled();
});

it("enforces the data limit on arguments accessor captures and releases deleted accessors", () => {
  const value = createSandboxArguments([]);
  const baseline = measureSandboxData([value]);
  const closure = createSandboxClosure({ call: () => undefined, retainedValues: () => ["x".repeat(100)] });
  Object.defineProperty(value, "hidden", { get: accessorAdapter(closure, "get"), configurable: true });
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 100 }), [value]))
    .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" }));
  Reflect.deleteProperty(value, "hidden");
  expect(measureSandboxData([value])).toBe(baseline);
});

it("captures later argument descriptors before visiting earlier retained callbacks", () => {
  const value = createSandboxArguments([]);
  const later = createSandboxClosure({ call: () => undefined, retainedValues: () => ["initial"] });
  value.first = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    Reflect.deleteProperty(value, "later");
    return [];
  } });
  const before = measureSandboxData([value]);
  Object.defineProperty(value, "later", { get: accessorAdapter(later, "get"), configurable: true });
  expect(measureSandboxData([value])).toBe(before + "later".length + 1 + 1 + "initial".length);
  expect(Object.hasOwn(value, "later")).toBe(false);
});

it("retains compiled regex tickets captured by escaping arguments accessors", () => {
  const budget = new Budget();
  const operation = budget.acquireCompileOwner();
  const parent = new CompileScope(operation.owner);
  const child = new CompileScope(operation.owner, parent);
  try {
    const regex = createSandboxRegex("a+", "g", 0, child);
    const ticket = [...child.tickets][0]!;
    const getter = createSandboxClosure({ call: () => regex, retainedValues: () => [regex] });
    const value = createSandboxArguments([]);
    Object.defineProperty(value, "hidden", { get: accessorAdapter(getter, "get") });
    reconcileCompiledValues(budget, [value], child, parent, [value]);
    child.dispose();
    expect(parent.tickets.has(ticket)).toBe(true);
    expect(budget.compileTicketUsage(ticket)).toBeGreaterThan(0);
    parent.dispose();
    expect(budget.compileTicketUsage(ticket)).toBe(0);
  } finally {
    child.dispose();
    parent.dispose();
    operation.release();
  }
});
