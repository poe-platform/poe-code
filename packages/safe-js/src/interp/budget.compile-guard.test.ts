import { describe, expect, it } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import { createSandboxRegex, reconcileCompiledValues } from "./values.js";

describe("compile accounting drafts", () => {
  it.each([false, true])(
    "keeps a completed graph across an older provision, dropped=%s",
    (dropped) => {
      const budget = new Budget({ dataSize: 200 });
      const baseline = "x".repeat(100);
      budget.reconcileDataUsage(100);
      const releaseProvisional = budget.provisionDataUsage(0);
      const operation = budget.acquireCompileOwner();
      const compilation = new CompileScope(operation.owner);
      const regex = createSandboxRegex("a", "", 0, compilation);
      const staged = budget.currentDataSize;
      reconcileCompiledValues(budget, [baseline, regex], compilation);
      compilation.dispose();
      operation.release();
      expect(budget.currentDataSize).toBe(staged);
      releaseProvisional();
      expect(budget.currentDataSize).toBe(staged);
      reconcileCompiledValues(budget, dropped ? [baseline] : [baseline, regex]);
      expect(budget.currentDataSize).toBe(dropped ? 100 : staged);
    }
  );

  it("checks growth and handoff without consuming a failed ticket", () => {
    const budget = new Budget({ dataSize: 10 });
    const operation = budget.acquireCompileOwner();
    const ticket = budget.createCompileTicket(operation.owner);
    budget.resizeCompileTicket(ticket, 4);
    const included = new Set([ticket]);
    expect(() => budget.resizeCompileTicket(ticket, 11)).toThrow(SandboxError);
    expect(budget.compileTicketUsage(ticket)).toBe(4);
    expect(() => budget.reconcileCompileData(11, included, included)).toThrow(SandboxError);
    expect(budget.compileTicketUsage(ticket)).toBe(4);
    budget.reconcileCompileData(4, included, included, {});
    budget.discardCompileTicket(ticket);
    expect(budget.currentDataSize).toBe(4);
    operation.release();
    const stale = budget.provisionDataUsage(1);
    budget.reset();
    budget.reconcileDataUsage(3);
    stale();
    expect(budget.currentDataSize).toBe(3);
  });

  it("discards only its ticket while preserving an over-budget primary failure", () => {
    const budget = new Budget({ dataSize: 10 });
    const operation = budget.acquireCompileOwner();
    budget.reconcileDataUsage(8);
    const ticket = budget.createCompileTicket(operation.owner);
    budget.resizeCompileTicket(ticket, 2);
    const unrelated = {};
    const resume = budget.suspendChecks();
    budget.setRetainedDataUsage(unrelated, 10);
    resume();
    const primary = new Error("primary");

    let caught: unknown;
    try {
      try {
        throw primary;
      } finally {
        budget.discardCompileTicket(ticket);
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(primary);
    expect(budget.currentDataSize).toBe(18);
    expect(budget.peakDataSize).toBe(20);
    expect(budget.stepsUsed).toBe(0);
    budget.discardCompileTicket(ticket);
    expect(budget.currentDataSize).toBe(18);
    expect(() => budget.reconcileDataUsage(8)).toThrow(SandboxError);
    operation.release();
    budget.reset();
    budget.reconcileDataUsage(3);
    budget.discardCompileTicket(ticket);
    expect(budget.currentDataSize).toBe(3);
  });

  it("rejects independent overlapping owners but permits idle sequential reuse", () => {
    const budget = new Budget();
    const first = budget.acquireCompileOwner(true);
    const child = budget.acquireCompileOwner(false, first.owner);
    expect(() => budget.acquireCompileOwner(true)).toThrow(SandboxError);
    expect(() => budget.reset()).toThrow(SandboxError);
    child.release();
    first.release();
    const second = budget.acquireCompileOwner(true);
    expect(() => budget.acquireCompileOwner(false, first.owner)).toThrow(SandboxError);
    second.release();
  });

  it("retains sibling tickets across rollback and transfers them exactly once", () => {
    const budget = new Budget({ dataSize: 140 });
    const operation = budget.acquireCompileOwner();
    budget.reconcileDataUsage(100);
    const releaseProvisional = budget.provisionDataUsage(0);
    const scratch = budget.createCompileTicket(operation.owner);
    const output = budget.createCompileTicket(operation.owner);
    budget.resizeCompileTicket(scratch, 10);
    budget.resizeCompileTicket(output, 20);
    budget.discardCompileTicket(scratch);
    const included = new Set([output]);
    budget.reconcileCompileData(120, included, included);
    expect(budget.currentDataSize).toBe(120);
    expect(budget.compileTicketUsage(output)).toBe(20);
    releaseProvisional();
    expect(budget.currentDataSize).toBe(120);
    budget.reconcileCompileData(120, included, included);
    expect(budget.currentDataSize).toBe(120);
    expect(budget.compileTicketUsage(output)).toBe(0);
    budget.discardCompileTicket(output);
    expect(budget.currentDataSize).toBe(120);
    budget.reconcileDataUsage(100);
    expect(budget.currentDataSize).toBe(100);
    operation.release();
  });
});
