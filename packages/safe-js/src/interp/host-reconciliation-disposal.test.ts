import { expect, it, vi } from "vitest";
import { HostCallJournal, type HostCallRecord, type HostCallResumeProof } from "./host-call.js";

it("stops waiting for joined callbacks when the journal is disposed", async () => {
  let reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  let release!: () => void;
  const callbacks = new Promise<void>(resolve => { release = resolve; });
  const journal = new HostCallJournal("source", [], request => ({ ...request,
    callbackDisposition: "joined", outcome: { status: "fulfilled", value: 7 }
  }));
  const record = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
  record.lifecycle = "running";
  const pending = journal.reconcile(record, {
    callbacks: new Map([[1, async () => undefined]]), replayed: [],
    waitForCallbacks: () => { reached(); return callbacks; },
    toSandboxValue: () => { throw new Error("Unexpected conversion"); }
  }).then(() => "fulfilled", error => error);
  try {
    await ready;
    journal.dispose();
    journal.dispose();
    const result = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve("still pending")))]);
    expect(result).toBeInstanceOf(TypeError);
    expect((result as Error).message).toMatch(/disposed/);
    expect(record.lifecycle).toBe("running");
    expect(journal.snapshotReplay().calls[0]).not.toHaveProperty("outcome");
  } finally {
    release();
    await pending;
  }
});

it("observes a provider rejection arriving after disposal", async () => {
  let reject!: (error: Error) => void;
  const proof = new Promise<HostCallResumeProof>((_resolve, no) => { reject = no; });
  const journal = new HostCallJournal("source", [], () => proof);
  const record = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
  record.lifecycle = "running";
  const pending = journal.reconcile(record);
  const rejected = expect(pending).rejects.toThrow(/disposed/);
  journal.dispose();
  reject(new Error("late provider failure"));
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  expect(record.lifecycle).toBe("running");
});

it("releases a pending reconciliation when disposal occurs without a provider reply", async () => {
  const journal = new HostCallJournal("source", [], () => new Promise(() => undefined));
  const record = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
  record.lifecycle = "running";
  const pending = journal.reconcile(record).then(() => "fulfilled", error => error);
  journal.dispose();
  const outcome = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve("still pending")))]);
  expect(outcome).toBeInstanceOf(TypeError);
  expect((outcome as Error).message).toMatch(/disposed/);
});

it("does not start external reconciliation after journal disposal", async () => {
  const provider = vi.fn();
  const journal = new HostCallJournal("source", [], provider);
  const record = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
  record.lifecycle = "running";
  journal.dispose();
  await expect(journal.reconcile(record)).rejects.toThrow(/disposed/);
  expect(provider).not.toHaveBeenCalled();
});

it("rejects a late reconciliation proof without recording its outcome after disposal", async () => {
  let release!: (proof: HostCallResumeProof) => void;
  const proof = new Promise<HostCallResumeProof>(resolve => { release = resolve; });
  const provider = vi.fn(() => proof);
  const journal = new HostCallJournal("source", [], provider);
  const record: HostCallRecord = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
  record.lifecycle = "running";
  const pending = journal.reconcile(record);
  expect(provider).toHaveBeenCalledOnce();
  journal.dispose();
  const rejected = expect(pending).rejects.toThrow(/disposed/);
  release({ callId: record.id, sourceHash: record.sourceHash, moduleId: record.moduleId,
    operation: record.operation, argumentDigest: record.argumentDigest,
    outcome: { status: "fulfilled", value: 7 } });
  await rejected;
  expect(record.lifecycle).toBe("running");
  expect(journal.snapshotReplay().calls[0]).not.toHaveProperty("outcome");
});
