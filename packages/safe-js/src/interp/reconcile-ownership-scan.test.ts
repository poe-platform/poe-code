import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import {
  createSandboxClosure,
  createSandboxRegex,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

function fixture() {
  const budget = new Budget({ dataSize: 1000 });
  const operation = budget.acquireCompileOwner();
  const parent = new CompileScope(operation.owner);
  const child = new CompileScope(operation.owner, parent);
  const regex = createSandboxRegex("a+", "g", 0, child);
  const ticket = [...child.tickets][0]!;
  const captures = vi.fn((): SandboxValue[] => [regex]);
  const closure = createSandboxClosure({
    call: () => undefined,
    retainedValues: captures
  });
  return {
    budget,
    parent,
    child,
    regex,
    ticket,
    captures,
    closure,
    close() {
      child.dispose();
      parent.dispose();
      operation.release();
    }
  };
}

it.each([false, true])(
  "keeps held tickets owned without rescanning escaping captures (escaping=%s)",
  (escaping) => {
    const f = fixture();
    const expected = measureSandboxData([f.closure]);
    const charge = f.budget.compileTicketUsage(f.ticket);
    const first = f.budget.deferReconciliation();
    const second = f.budget.deferReconciliation();
    f.captures.mockClear();
    try {
      reconcileCompiledValues(
        f.budget,
        [f.closure],
        f.child,
        f.parent,
        escaping ? [f.closure] : []
      );
      expect(f.captures).toHaveBeenCalledTimes(1);
      expect(f.budget.currentDataSize).toBe(expected);
      expect(f.budget.compileTicketUsage(f.ticket)).toBe(charge);
      expect(f.child.tickets.has(f.ticket)).toBe(false);
      expect(f.parent.tickets.has(f.ticket)).toBe(true);
      first();
      f.captures.mockClear();
      reconcileCompiledValues(f.budget, [f.closure], f.parent, f.parent, [f.closure]);
      expect(f.captures).toHaveBeenCalledTimes(1);
      expect(f.budget.compileTicketUsage(f.ticket)).toBe(charge);
      second();
      f.captures.mockClear();
      reconcileCompiledValues(f.budget, [f.closure], f.parent, f.parent, [f.closure]);
      expect(f.captures).toHaveBeenCalledTimes(2);
      expect(f.budget.compileTicketUsage(f.ticket)).toBe(charge);
      f.parent.dispose();
      expect(f.budget.compileTicketUsage(f.ticket)).toBe(0);
    } finally {
      first();
      second();
      f.close();
    }
  }
);

it("does not rescan persistent regex metadata after its staged charge is released", () => {
  const f = fixture();
  try {
    reconcileCompiledValues(f.budget, [f.closure], f.child, f.parent);
    expect(f.budget.compileTicketUsage(f.ticket)).toBe(0);
    const expected = measureSandboxData([f.closure]);
    f.captures.mockClear();
    reconcileCompiledValues(f.budget, [f.closure], f.child, f.parent, [f.closure]);
    expect(f.captures).toHaveBeenCalledTimes(1);
    expect(f.budget.currentDataSize).toBe(expected);
    expect(f.child.tickets.size).toBe(0);
    expect(f.parent.tickets.size).toBe(0);
  } finally {
    f.close();
  }
});

it("still measures all captured descendants and rejects their aggregate during a hold", () => {
  const f = fixture();
  const release = f.budget.deferReconciliation();
  f.captures.mockImplementation(() => [f.regex, "x".repeat(600), "y".repeat(600)]);
  try {
    expect(() =>
      reconcileCompiledValues(f.budget, [f.closure], f.child, f.parent, [f.closure])
    ).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" }));
    expect(f.captures).toHaveBeenCalledTimes(1);
    expect(f.child.tickets.has(f.ticket)).toBe(true);
    expect(f.budget.compileTicketUsage(f.ticket)).toBeGreaterThan(0);
  } finally {
    release();
    f.close();
  }
});

it("checks the hold after primary captures so a capture can release the final hold", () => {
  const f = fixture();
  const release = f.budget.deferReconciliation();
  f.captures.mockImplementation(() => {
    release();
    return [f.regex];
  });
  try {
    reconcileCompiledValues(f.budget, [f.closure], f.child, f.parent, [f.closure]);
    expect(f.captures).toHaveBeenCalledTimes(2);
    expect(f.budget.reconciliationDeferred).toBe(false);
    expect(f.parent.tickets.has(f.ticket)).toBe(true);
    expect(f.budget.compileTicketUsage(f.ticket)).toBeGreaterThan(0);
  } finally {
    release();
    f.close();
  }
});

it("keeps tickets staged when a primary capture acquires a hold", () => {
  const f = fixture();
  const expected = measureSandboxData([f.closure]);
  const charge = f.budget.compileTicketUsage(f.ticket);
  let release: (() => void) | undefined;
  f.captures.mockClear();
  f.captures.mockImplementationOnce(() => {
    release = f.budget.deferReconciliation();
    return [f.regex];
  });
  try {
    reconcileCompiledValues(f.budget, [f.closure], f.child, f.parent, [f.closure]);
    expect(f.captures).toHaveBeenCalledTimes(1);
    expect(f.budget.reconciliationDeferred).toBe(true);
    expect(f.budget.currentDataSize).toBe(expected);
    expect(f.budget.compileTicketUsage(f.ticket)).toBe(charge);
    expect(f.parent.tickets.has(f.ticket)).toBe(true);
  } finally {
    release?.();
    f.close();
  }
});
