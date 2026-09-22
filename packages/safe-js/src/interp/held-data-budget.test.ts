import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createIntrinsicObject } from "./object-model.js";
import { reconcileCompiledValues } from "./values.js";

it("enforces aggregate live data while reconciliation is held", () => {
  const budget = new Budget({ dataSize: 100 });
  const release = budget.deferReconciliation();
  const first = createIntrinsicObject({ text: "x".repeat(60) });
  const second = createIntrinsicObject({ text: "y".repeat(60) });
  try {
    expect(() => reconcileCompiledValues(budget, [first, first])).not.toThrow();
    expect(budget.currentDataSize).toBe(66);
    expect(() => reconcileCompiledValues(budget, [first, second])).toThrow(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "dataSize",
        current: 132
      })
    );
    expect(budget.currentDataSize).toBe(66);
  } finally {
    release();
  }
});

it("keeps included compile tickets owned without charging their graph bytes twice", () => {
  const budget = new Budget({ dataSize: 40 });
  const owner = budget.acquireCompileOwner(true);
  const ticket = budget.createCompileTicket(owner.owner);
  budget.resizeCompileTicket(ticket, 20);
  budget.chargeDataUsage(10);
  const release = budget.deferReconciliation();
  try {
    budget.discardCompileTicket(ticket);
    expect(() => budget.reconcileCompileData(35, new Set([ticket]))).not.toThrow();
    expect(budget.currentDataSize).toBe(35);
    expect(budget.compileTicketUsage(ticket)).toBe(20);
    budget.reconcileCompileData(0, new Set());
    expect(budget.currentDataSize).toBe(35);
    expect(budget.peakDataSize).toBe(35);
    release();
    reconcileCompiledValues(budget, []);
    expect(budget.currentDataSize).toBe(0);
    expect(budget.compileTicketUsage(ticket)).toBe(0);
  } finally {
    release();
    owner.release();
  }
});

it("keeps unincluded compile tickets charged during a hold", () => {
  const budget = new Budget({ dataSize: 40 });
  const owner = budget.acquireCompileOwner(true);
  const included = budget.createCompileTicket(owner.owner);
  const other = budget.createCompileTicket(owner.owner);
  budget.resizeCompileTicket(included, 20);
  budget.resizeCompileTicket(other, 10);
  const release = budget.deferReconciliation();
  try {
    expect(() => budget.reconcileCompileData(35, new Set([included]))).toThrow(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "dataSize",
        current: 45
      })
    );
    expect(budget.compileTicketUsage(included)).toBe(20);
    expect(budget.compileTicketUsage(other)).toBe(10);
    expect(budget.currentDataSize).toBe(30);
  } finally {
    release();
    owner.release();
  }
});

it("measures retained generator frame locals during a held reconciliation", async () => {
  const { run } = await import("../run.js");
  const result = await run(
    "const g=(function*(){const local={text:'x'.repeat(30000)};yield 0;return local;})();g.next();return g;"
  );
  if (!result.ok) throw result.error;
  const budget = new Budget({ dataSize: 50000 });
  const release = budget.deferReconciliation();
  try {
    reconcileCompiledValues(budget, [result.returnValue]);
    expect(budget.currentDataSize).toBeGreaterThanOrEqual(30000);
    expect(() => reconcileCompiledValues(budget, [result.returnValue, "y".repeat(30000)])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release();
  }
});
