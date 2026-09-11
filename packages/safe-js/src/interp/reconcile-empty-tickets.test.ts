import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import { createSandboxClosure, createSandboxRegex, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("does not rescan escaping captures when there are no compiled tickets to retain", () => {
  const budget = new Budget();
  const parent = new CompileScope();
  const child = new CompileScope(undefined,parent);
  const captures = vi.fn(()=>["retained payload"]);
  const closure = createSandboxClosure({call:()=>undefined,retainedValues:captures});
  const expected = measureSandboxData([closure]);
  captures.mockClear();
  reconcileCompiledValues(budget,[closure],child,parent,[closure]);
  expect(budget.currentDataSize).toBe(expected);
  expect(captures).toHaveBeenCalledTimes(1);
});

it("still rejects excessive captured data without regex tickets", () => {
  const budget = new Budget({dataSize:100});
  const closure = createSandboxClosure({call:()=>undefined,retainedValues:()=>["x".repeat(101)]});
  const parent = new CompileScope();
  expect(()=>reconcileCompiledValues(budget,[closure],new CompileScope(undefined,parent),parent,[closure]))
    .toThrow(expect.objectContaining({code:"budgetExceeded",budget:"dataSize"}));
});

it.each([false,true])("preserves compiled-ticket ownership when escaping=%s", escaping => {
  const budget = new Budget();
  const operation = budget.acquireCompileOwner();
  const parent = new CompileScope(operation.owner);
  const child = new CompileScope(operation.owner,parent);
  try {
    const regex = createSandboxRegex("a+","g",0,child);
    const ticket = [...child.tickets][0]!;
    expect(budget.compileTicketUsage(ticket)).toBeGreaterThan(0);
    reconcileCompiledValues(budget,[regex],child,parent,escaping?[regex]:[]);
    expect(parent.tickets.has(ticket)).toBe(escaping);
    expect(child.tickets.has(ticket)).toBe(false);
    child.dispose();
    expect(budget.compileTicketUsage(ticket)>0).toBe(escaping);
    parent.dispose();
    expect(budget.compileTicketUsage(ticket)).toBe(0);
  } finally {
    child.dispose();
    parent.dispose();
    operation.release();
  }
});
