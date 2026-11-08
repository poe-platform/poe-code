import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { FinalizationRegistryState } from "./finalization-registry-state.js";
import { SandboxJobQueue } from "./jobs.js";
import { createOwnedFinalizationRegistryState, type FinalizationActivation } from "./owned-finalization-registry.js";
import { runResources } from "./resources.js";
import { createSandboxClosure } from "./values.js";

it.each(["unregister", "dispose"])("releases a queued cell's held value on %s before dispatch", async mode => {
  const jobs: Array<() => Promise<void>> = [];
  const cleanup = vi.fn(async () => {});
  const state = new FinalizationRegistryState(cleanup, job => { jobs.push(job); });
  const token = {};
  const held = { payload: "cancelled-held-value" };
  state.register(undefined, held, token);
  const [cell] = state.cells;
  expect(cell!.heldValue).toBe(held);
  if (mode === "unregister") expect(state.unregister(token)).toBe(true);
  else state.dispose();
  // A scheduled job can remain blocked indefinitely; cancellation must sever
  // its cell's payload edge without waiting for that job or for host GC.
  expect(cell!.heldValue).toBeUndefined();
  expect(state.cells.size).toBe(0);
  await jobs[0]!();
  expect(cleanup).not.toHaveBeenCalled();
});

it("keeps another token's held value until its cleanup finishes", async () => {
  const jobs: Array<() => Promise<void>> = [];
  const failure = new Error("cleanup failed");
  const cleanup = vi.fn(async () => { throw failure; });
  const state = new FinalizationRegistryState(cleanup, job => { jobs.push(job); });
  const token = {};
  const held = { payload: "live-held-value" };
  state.register(undefined, { payload: "cancelled" }, token);
  state.register(undefined, held, {});
  const [, live] = state.cells;
  expect(state.unregister(token)).toBe(true);
  expect(live!.heldValue).toBe(held);
  await jobs[0]!();
  expect(cleanup).not.toHaveBeenCalled();
  await expect(jobs[1]!()).rejects.toBe(failure);
  expect(cleanup).toHaveBeenCalledExactlyOnceWith(held);
  expect(live!.heldValue).toBeUndefined();
  expect(state.cells.size).toBe(0);
});

it.each(["unregister", "dispose", "rollback", "deferred-unregister"])("releases owner-held roots on %s before the owning queue drains", async mode => {
  const budget = new Budget();
  const queue = new SandboxJobQueue();
  const cleanup = vi.fn(() => undefined);
  const callback = createSandboxClosure({ call: cleanup });
  const held = { payload: "owned-held-value" };
  const token = {};
  const activation: FinalizationActivation | undefined = mode === "rollback" || mode === "deferred-unregister"
    ? { phase: "pending", pending: [], rollback: [] } : undefined;
  const reportError = vi.fn();
  await runResources.run({ signal: new AbortController().signal, referenceReleases: new Set(),
    reportError, add: () => () => {} }, async () => {
    await queue.run(() => {
      const state = createOwnedFinalizationRegistryState(callback, budget, undefined, activation);
      state.register(undefined, held, token);
      const [cell] = state.cells;
      if (activation === undefined) expect([...budget.retainedValues()]).toContain(held);
      if (mode === "unregister") expect(state.unregister(token)).toBe(true);
      else if (activation === undefined) state.dispose();
      else if (mode === "rollback") {
        activation.phase = "cancelled";
        for (const rollback of activation.rollback) rollback();
        // Even a stale activation closure cannot re-root a cancelled payload.
        for (const dispatch of activation.pending) dispatch();
      } else {
        expect(state.unregister(token)).toBe(true);
        activation.phase = "active";
        for (const dispatch of activation.pending) dispatch();
      }
      expect(cell!.heldValue).toBeUndefined();
      expect([...budget.retainedValues()]).not.toContain(held);
      expect([...budget.retainedValues()]).not.toContain(callback);
      state.dispose();
    });
    await queue.drain();
  });
  expect(cleanup).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});
