import { expect, it } from "vitest";
import { HostCallJournal } from "./host-call.js";
import { Budget } from "./budget.js";
import { deepCopyToSandbox, isSandboxPromise, type SandboxValue } from "./values.js";

it.each([
  { name: "string at limit", value: "x".repeat(16), limits: { stringLength: 16 }, accepted: true },
  { name: "string beyond limit", value: "x".repeat(17), limits: { stringLength: 16 }, accepted: false },
  { name: "array at limit", value: Array.from({ length: 4 }, () => 1), limits: { arrayLength: 4 }, accepted: true },
  { name: "array beyond limit", value: Array.from({ length: 5 }, () => 1), limits: { arrayLength: 4 }, accepted: false },
  { name: "data beyond limit", value: "x".repeat(20000), limits: { dataSize: 10000 }, accepted: false }
])("enforces proof budgets: $name", async ({ value, limits, accepted }) => {
  const input = { moduleId: "host", operation: "read", argumentDigest: "args", policy: "re-issue" as const };
  const original = new HostCallJournal("source");
  const record = original.issue(input).record;
  const nested = deepCopyToSandbox(new Promise(() => undefined));
  original.settle(record, { status: "fulfilled", value: { nested } });
  const replay = original.snapshotReplay();
  original.dispose();
  const budget = new Budget(limits);
  const journal = new HostCallJournal("source", [], request => ({ ...request,
    outcome: { status: "fulfilled", value } }), replay, budget);
  try {
    const next = journal.issue(input).record;
    const outcome = journal.replayOutcome(next);
    if (outcome?.status !== "fulfilled") throw new Error("Missing parent outcome");
    const pending = (outcome.value as Record<string, SandboxValue>).nested;
    if (!isSandboxPromise(pending)) throw new Error("Missing nested Promise");
    if (accepted) await expect(pending.promise).resolves.toEqual(value);
    else {
      await expect(pending.promise).rejects.toThrow();
      expect(journal.snapshotReplay().calls[0]!.outcome!.data.nodes.some(node => node.kind === "pending-imported-promise")).toBe(true);
    }
  } finally {
    journal.dispose();
  }
});
