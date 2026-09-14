import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { createAtomicsGlobal } from "../interp/globals/atomics.js";
import { withRunResources } from "../interp/resources.js";
import { createSharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import type { SandboxClosure } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

const schedule = vi.hoisted(() => ({ mutateBeforeRegistration: false, terminations: 0 }));
vi.mock("node:worker_threads", () => ({ Worker: class extends EventEmitter {
  private readonly views: Int32Array[] = [];
  postMessage(message: { id: number; buffer: SharedArrayBuffer; offset: number; expected: number; timeout: number }) {
    const view = new Int32Array(message.buffer, message.offset, 1);
    this.views.push(view);
    if (schedule.mutateBeforeRegistration) Atomics.store(view, 0, 1);
    const result = Reflect.get(Atomics, "waitAsync")(view, 0, message.expected, message.timeout);
    this.emit("message", { id: message.id, kind: "registered", async: result.async,
      value: result.async ? undefined : result.value });
    if (result.async) void result.value.then((value: string) => this.emit("message", { id: message.id, kind: "settled", value }));
  }
  async terminate() {
    schedule.terminations++;
    for (const view of this.views) Atomics.notify(view, 0);
    this.emit("exit", 1);
    return 1;
  }
} }));

it("rejects a restored registration race instead of inventing a not-equal settlement", async () => {
  schedule.mutateBeforeRegistration = false;
  schedule.terminations = 0;
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const wait = await (createAtomicsGlobal(budget).waitAsync as SandboxClosure).call([view, 0, 0]);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { view, wait } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(saved, { source });
    schedule.mutateBeforeRegistration = true;
    try {
      await expect(withRunResources(undefined, () => restored.activateAtomicWaits()))
        .rejects.toThrow("Concurrent shared mutation prevents atomic wait restoration");
      expect(Atomics.notify(restored.currentScope.lookup("view").value as Int32Array, 0)).toBe(0);
      // The original registered waiter stays queued even after its value changes.
      Atomics.store(view, 0, 1);
      expect(Atomics.notify(view, 0)).toBe(1);
    } finally { schedule.mutateBeforeRegistration = false; }
  });
  expect(schedule.terminations).toBe(2);
});
