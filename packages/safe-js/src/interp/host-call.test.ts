import { describe, expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure } from "./values.js";

import {
  digestHostCallArguments,
  HostCallJournal,
  HostCallResumabilityError,
  type HostCallRecord
} from "./host-call.js";

const sourceHash = "source-hash";

function pendingRecord(overrides: Partial<HostCallRecord> = {}): HostCallRecord {
  return {
    id: "run:1",
    runId: "run",
    sourceHash,
    moduleId: "payments",
    operation: "charge",
    argumentDigest: digestHostCallArguments(["order-1"]),
    policy: "read-side-effect",
    lifecycle: "running",
    ...overrides
  };
}

describe("HostCallJournal", () => {
  it("does not let snapshot consumers mutate journal capability or callback metadata", () => {
    const journal = new HostCallJournal(sourceHash);
    const record = journal.issue({
      moduleId: "host",
      operation: "apply",
      argumentDigest: "args",
      policy: "re-issue"
    }).record;
    journal.registerCallbackFunction(
      record,
      1,
      createSandboxClosure({ call: () => 42 }),
      async () => undefined
    );
    journal.recordCallback(record, 1, [42], 1);
    const snapshot = journal.snapshotReplay();
    snapshot.calls[0]!.functions!.push(99);
    snapshot.calls[0]!.callbacks![0]!.id = 99;
    expect(journal.snapshotReplay().calls[0]).toMatchObject({
      functions: [1],
      callbacks: [{ id: 1 }]
    });
  });
  it("restores returned source capabilities only after their matching invocation registers them", () => {
    const journal = new HostCallJournal(sourceHash);
    const input = {
      moduleId: "host",
      operation: "echo",
      argumentDigest: "args",
      policy: "re-issue" as const
    };
    const first = journal.issue(input).record;
    const closure = createSandboxClosure({ call: () => 42 });
    journal.registerCallbackFunction(first, 1, closure, async () => undefined);
    journal.settle(first, { status: "fulfilled", value: closure });
    const replay = JSON.parse(JSON.stringify(journal.snapshotReplay()));
    const restored = new HostCallJournal(sourceHash, [], undefined, replay);
    const next = restored.issue(input).record;
    expect(() => restored.replayOutcome(next)).toThrow(/capability/i);
    const replacement = createSandboxClosure({ call: () => 42 });
    restored.registerCallbackFunction(next, 1, replacement, async () => undefined);
    expect(restored.replayOutcome(next)).toEqual({ status: "fulfilled", value: replacement });
    replay.calls[0].functions = [];
    expect(() => new HostCallJournal(sourceHash, [], undefined, replay)).toThrow(/capability/i);
  });
  it.each(["joined", "detached"] as const)(
    "honors the proof's %s callback disposition",
    async (callbackDisposition) => {
      const record = pendingRecord();
      const waitForCallbacks = vi.fn(async () => undefined);
      const journal = new HostCallJournal(sourceHash, [record], (request) => ({
        ...request,
        callbackDisposition,
        outcome: { status: "fulfilled", value: "done" }
      }));
      const outcome = await journal.reconcile(record, {
        callbacks: new Map([[1, async () => undefined]]),
        replayed: [],
        waitForCallbacks
      });
      expect(outcome).toEqual({ status: "fulfilled", value: "done" });
      expect(waitForCallbacks).toHaveBeenCalledTimes(callbackDisposition === "joined" ? 1 : 0);
    }
  );
  it("charges the same callback data before and after restoring the journal", () => {
    const budget = new Budget();
    const journal = new HostCallJournal(sourceHash, [], undefined, undefined, budget);
    const record = journal.issue({
      moduleId: "host",
      operation: "apply",
      argumentDigest: "args",
      policy: "re-issue"
    }).record;
    journal.recordCallback(record, 1, ["value", { count: 2 }], 3);
    const restoredBudget = new Budget();
    new HostCallJournal(sourceHash, [], undefined, journal.snapshotReplay(), restoredBudget);
    expect(restoredBudget.currentDataSize).toBe(budget.currentDataSize);
  });
  it("uses stable run-scoped ids and explicit lifecycle transitions", () => {
    const journal = new HostCallJournal(sourceHash);
    const issued = journal.issue({
      moduleId: "payments",
      operation: "charge",
      argumentDigest: digestHostCallArguments(["order-1"]),
      policy: "read-side-effect"
    });

    expect(issued.record).toMatchObject({ lifecycle: "created" });
    journal.start(issued.record);
    expect(issued.record.lifecycle).toBe("running");
    journal.settle(issued.record, { status: "fulfilled", value: "charged" });
    expect(issued.record.lifecycle).toBe("settled");
    journal.consume(issued.record);
    expect(issued.record.lifecycle).toBe("consumed");
    expect(journal.snapshot()).toEqual([expect.objectContaining({ lifecycle: "consumed" })]);
  });

  it("rejects double consumption", () => {
    const record = pendingRecord({
      lifecycle: "settled",
      outcome: { status: "fulfilled", value: "charged" }
    });
    const journal = new HostCallJournal(sourceHash, [record]);
    const restored = journal.issue({
      moduleId: record.moduleId,
      operation: record.operation,
      argumentDigest: record.argumentDigest,
      policy: record.policy
    }).record;
    journal.consume(restored);

    expect(() => journal.consume(restored)).toThrowError(HostCallResumabilityError);
  });

  it("fails closed when the next restored call does not match", () => {
    const first = pendingRecord({
      id: "run:1",
      argumentDigest: digestHostCallArguments(["order-1"])
    });
    const second = pendingRecord({
      id: "run:2",
      argumentDigest: digestHostCallArguments(["order-2"])
    });
    const journal = new HostCallJournal(sourceHash, [first, second]);

    expect(() =>
      journal.issue({
        moduleId: second.moduleId,
        operation: second.operation,
        argumentDigest: second.argumentDigest,
        policy: second.policy
      })
    ).toThrowError(HostCallResumabilityError);
  });

  it("re-issues omitted calls before matching the next restored ordinal", () => {
    const pending = pendingRecord({
      id: "run:2",
      argumentDigest: digestHostCallArguments(["pending"]),
      policy: "re-issue"
    });
    const journal = new HostCallJournal(sourceHash, [pending]);

    const completed = journal.issue({
      moduleId: pending.moduleId,
      operation: pending.operation,
      argumentDigest: digestHostCallArguments(["completed"]),
      policy: pending.policy
    });
    const restored = journal.issue({
      moduleId: pending.moduleId,
      operation: pending.operation,
      argumentDigest: pending.argumentDigest,
      policy: pending.policy
    });

    expect(completed).toMatchObject({ restored: false, record: { id: "run:1" } });
    expect(restored).toMatchObject({ restored: true, record: { id: "run:2" } });
  });

  it("requires reset after cancellation", async () => {
    const record = pendingRecord({
      lifecycle: "cancelled",
      outcome: { status: "rejected", reason: { name: "AbortError", message: "aborted" } }
    });
    const journal = new HostCallJournal(sourceHash, [record]);

    await expect(journal.reconcile(journal.snapshot()[0]!)).rejects.toMatchObject({
      action: "reset",
      lifecycle: "cancelled"
    });
  });

  it("keeps a restored created call eligible for first dispatch", () => {
    const record = pendingRecord({ lifecycle: "created" });
    const journal = new HostCallJournal(sourceHash, [record], () => {
      throw new Error("created calls must not require reconciliation");
    });

    const issued = journal.issue({
      moduleId: record.moduleId,
      operation: record.operation,
      argumentDigest: record.argumentDigest,
      policy: record.policy
    });

    expect(issued).toMatchObject({ restored: true, record: { lifecycle: "created" } });
  });

  it.each(["callId", "sourceHash", "moduleId", "operation", "argumentDigest"] as const)(
    "rejects a proof with mismatched %s",
    async (field) => {
      const record = pendingRecord();
      const journal = new HostCallJournal(sourceHash, [record], (request) => ({
        callId: request.callId,
        sourceHash: request.sourceHash,
        moduleId: request.moduleId,
        operation: request.operation,
        argumentDigest: request.argumentDigest,
        outcome: { status: "fulfilled", value: "charged" },
        [field]: "wrong"
      }));

      await expect(journal.reconcile(journal.snapshot()[0]!)).rejects.toMatchObject({
        action: "external-reconciliation"
      });
      expect(journal.snapshot()[0]).toMatchObject({ lifecycle: "running" });
    }
  );

  it("replays a settled result without external reconciliation", async () => {
    const record = pendingRecord({
      lifecycle: "settled",
      outcome: { status: "rejected", reason: "declined" }
    });
    const journal = new HostCallJournal(sourceHash, [record], () => {
      throw new Error("provider must not run");
    });

    await expect(journal.reconcile(journal.snapshot()[0]!)).resolves.toEqual({
      status: "rejected",
      reason: "declined"
    });
  });
});
