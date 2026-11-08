import { expect, it } from "vitest";
import { HostCallJournal } from "./host-call.js";
import { createSandboxClosure, deepCopyToSandbox, isSandboxPromise, type SandboxValue } from "./values.js";

it.each(["fulfilled", "rejected"] as const)("preserves a retryable checkpoint after an unencodable %s proof", async status => {
  const input = { moduleId: "host", operation: "read", argumentDigest: "args", policy: "re-issue" as const };
  const original = new HostCallJournal("source");
  const record = original.issue(input).record;
  original.settle(record, { status: "fulfilled", value: { nested: deepCopyToSandbox(new Promise(() => undefined)) } });
  const replay = original.snapshotReplay();
  original.dispose();
  const value = { next: deepCopyToSandbox(new Promise(() => undefined)), unsupported: createSandboxClosure({ call: () => 7 }) };
  const journal = new HostCallJournal("source", [], request => ({ ...request,
    outcome: status === "fulfilled" ? { status, value } : { status, reason: value } }), replay);
  try {
    const outcome = journal.replayOutcome(journal.issue(input).record);
    if (outcome?.status !== "fulfilled") throw new Error("Missing parent outcome");
    const nested = (outcome.value as Record<string, SandboxValue>).nested;
    if (!isSandboxPromise(nested)) throw new Error("Missing nested Promise");
    await expect(nested.promise).rejects.toThrow(/resume capability/);
    const checkpoint = journal.snapshotReplay();
    expect(checkpoint.calls[0]!.outcome!.data).toEqual(replay.calls[0]!.outcome!.data);
    const retry = new HostCallJournal("source", [], request => ({ ...request, outcome: { status: "fulfilled", value: 9 } }), checkpoint);
    try {
      const retried = retry.replayOutcome(retry.issue(input).record);
      if (retried?.status !== "fulfilled") throw new Error("Missing retry outcome");
      const pending = (retried.value as Record<string, SandboxValue>).nested;
      if (!isSandboxPromise(pending)) throw new Error("Missing retry Promise");
      await expect(pending.promise).resolves.toBe(9);
    } finally { retry.dispose(); }
  } finally { journal.dispose(); }
});
