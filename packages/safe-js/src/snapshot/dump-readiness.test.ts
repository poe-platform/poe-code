import { expect, it } from "vitest";
import { createDumpController } from "./dump.js";
import { SnapshotNotReadyError } from "./not-ready.js";
import { createThenableBridge } from "../interp/promise.js";
import { Budget } from "../interp/budget.js";

it("keeps a live request pending until a later serializable yield", async () => {
  const bridge = createThenableBridge({source: {}, owner: undefined, settlement: undefined,
    invocationPending: true, completed: false}, {budget: new Budget()});
  const controller = createDumpController();
  const request = controller.requestSnapshot();
  let settled = false;
  void request.then(() => { settled = true; });
  controller.onYield(() => ({sourceHash: "test", bindings: {resolve: bridge.resolvers[0]}}));
  await Promise.resolve();
  expect(settled).toBe(false);
  controller.onYield(() => ({sourceHash: "test", bindings: {answer: 42}}));
  expect(JSON.parse(await request).bindings).toEqual({answer: 42});
});

it("rejects a pending request when final state is still not serializable", async () => {
  const bridge = createThenableBridge({source: {}, owner: undefined, settlement: undefined,
    invocationPending: true, completed: false}, {budget: new Budget()});
  const snapshot = {sourceHash: "test", bindings: {resolve: bridge.resolvers[0]}};
  const controller = createDumpController();
  const rejected = expect(controller.requestSnapshot()).rejects.toBeInstanceOf(SnapshotNotReadyError);
  controller.onYield(() => snapshot);
  controller.finalize(snapshot);
  await rejected;
  await expect(controller.requestSnapshot()).rejects.toBeInstanceOf(SnapshotNotReadyError);
});
