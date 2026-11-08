import { describe, expect, it, vi } from "vitest";

import { declareHostOperation, dump, restore, run } from "./index.js";

describe("completed host-result prototype replay", () => {
  it("preserves native String coercion after replaying an ordinary host record", async () => {
    const expected = String({ label: "ack", accepted: true });
    const source = "const value = await ack(); return String(value);";
    const originalHost = vi.fn(async () => ({ label: "ack", accepted: true }));
    declareHostOperation(originalHost, "re-issue");
    const execution = run(source, { bindings: { ack: originalHost } });
    const original = await execution;
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error("Original execution did not complete");
    expect(original.returnValue).toBe(expected);
    expect(originalHost).toHaveBeenCalledTimes(1);

    const serialized = await dump(execution);
    const replayHost = vi.fn(async () => ({ label: "unexpected", accepted: false }));
    declareHostOperation(replayHost, "re-issue");
    const replayed = await run(source, {
      bindings: { ack: replayHost },
      snapshot: restore(JSON.parse(serialized), { source })
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) throw new Error("Restored execution did not complete");
    expect(replayed.returnValue).toBe(expected);
    expect(replayHost).not.toHaveBeenCalled();
  });

  it("does not graft Object.prototype onto a genuine null-prototype host record", async () => {
    const source = "return await ack();";
    const value = Object.assign(Object.create(null), { label: "ack", accepted: true });
    const originalHost = vi.fn(async () => value);
    declareHostOperation(originalHost, "re-issue");
    const execution = run(source, { bindings: { ack: originalHost } });
    const original = await execution;
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error("Original execution did not complete");
    expect(Object.getPrototypeOf(original.returnValue)).toBeNull();

    const serialized = await dump(execution);
    const replayHost = vi.fn(async () => ({ label: "unexpected", accepted: false }));
    declareHostOperation(replayHost, "re-issue");
    const replayed = await run(source, {
      bindings: { ack: replayHost },
      snapshot: restore(JSON.parse(serialized), { source })
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) throw new Error("Restored execution did not complete");
    expect(Object.getPrototypeOf(replayed.returnValue)).toBeNull();
    expect(replayed.returnValue).toEqual(value);
    expect(replayHost).not.toHaveBeenCalled();
  });
});
