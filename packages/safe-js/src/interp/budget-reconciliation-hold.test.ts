import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { reconcileCompiledValues } from "./values.js";

it("defers compiled ticket disposal and reconciliation until the last hold is released", () => {
  const budget = new Budget({ dataSize: 1000 });
  const owner = budget.acquireCompileOwner(true);
  const ticket = budget.createCompileTicket(owner.owner);
  budget.resizeCompileTicket(ticket, 20);
  budget.chargeDataUsage(10);
  const first = budget.deferReconciliation();
  const second = budget.deferReconciliation();
  try {
    budget.discardCompileTicket(ticket);
    reconcileCompiledValues(budget, []);
    expect(budget.compileTicketUsage(ticket)).toBe(20);
    expect(budget.currentDataSize).toBe(30);
    first();
    first();
    expect(budget.reconciliationDeferred).toBe(true);
    second();
    expect(budget.reconciliationDeferred).toBe(false);
    reconcileCompiledValues(budget, []);
    expect(budget.compileTicketUsage(ticket)).toBe(0);
    expect(budget.currentDataSize).toBe(0);
  } finally {
    first();
    second();
    owner.release();
  }
});

it("does not roll back another suspended operation's allocations", () => {
  const budget = new Budget();
  const release = budget.deferReconciliation();
  const rollback = budget.provisionDataUsage(10);
  budget.chargeDataUsage(20);
  rollback();
  expect(budget.currentDataSize).toBe(30);
  release();
  reconcileCompiledValues(budget, []);
  expect(budget.currentDataSize).toBe(0);
});
