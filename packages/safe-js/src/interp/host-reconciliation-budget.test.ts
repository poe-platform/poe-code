import { describe, expect, it } from "vitest";
import { HostCallJournal } from "./host-call.js";
import { Budget } from "./budget.js";

describe.each(["fulfilled", "rejected"] as const)("reconciliation %s proof", status => {
it.each([
  { value: "x".repeat(16), limits: { stringLength: 16 }, accepted: true },
  { value: "x".repeat(17), limits: { stringLength: 16 }, accepted: false },
  { value: [1, 2, 3, 4], limits: { arrayLength: 4 }, accepted: true },
  { value: [1, 2, 3, 4, 5], limits: { arrayLength: 4 }, accepted: false },
  { value: { nested: "x".repeat(17) }, limits: { stringLength: 16 }, accepted: false },
  { value: Object.defineProperty({}, "hidden", { value: "x".repeat(17) }), limits: { stringLength: 16 }, accepted: false }
])("applies allocation limits to reconciled results %j", async ({ value, limits, accepted }) => {
  const budget = new Budget(limits);
  const journal = new HostCallJournal("source", [], request => ({ ...request,
    outcome: status === "fulfilled" ? { status, value } : { status, reason: value } }), undefined, budget);
  const record = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
  record.lifecycle = "running";
  const initial = budget.currentDataSize;
  try {
    if (accepted) await expect(journal.reconcile(record)).resolves.toEqual(
      status === "fulfilled" ? { status, value } : { status, reason: value });
    else {
      await expect(journal.reconcile(record)).rejects.toMatchObject({ code: "budgetExceeded", budget: Object.keys(limits)[0] });
      expect(record.lifecycle).toBe("running");
      expect(budget.currentDataSize).toBe(initial);
      expect(journal.snapshotReplay().calls[0]).not.toHaveProperty("outcome");
    }
  } finally { journal.dispose(); }
});
});
