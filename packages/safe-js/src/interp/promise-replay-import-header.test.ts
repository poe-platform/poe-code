import { expect, it } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { PromiseReplay } from "./promise-replay.js";

it.each([undefined, null, 1, [0], [-1], [1.5], [3], [1, 1], ["1"]])(
  "rejects an invalid imported scheduling header %j", importedPromises => {
    expect(() => new PromiseReplay({ version: 1, steps: 0, promises: 2, settlements: [], importedPromises })).toThrow();
  }
);

it("preserves legacy headers without imported scheduling metadata", () => {
  const replay = new PromiseReplay({ version: 1, steps: 0, promises: 1, settlements: [] });
  expect(() => replay.validateImportedPromises(new Set())).not.toThrow();
  expect(() => replay.validateImportedPromises(new Set([1]))).toThrow(/scheduling/);
  expect(replay.snapshot()).not.toHaveProperty("importedPromises");
});

it("copies serialized scheduling identities at both boundaries", async () => {
  const replay = new PromiseReplay();
  await replay.track(Promise.resolve(7));
  const ids = [1];
  replay.recordSerializedImportedPromises(ids);
  ids[0] = 2;
  const first = replay.snapshot();
  expect(first.importedPromises).toEqual([1]);
  first.importedPromises![0] = 2;
  expect(replay.snapshot().importedPromises).toEqual([1]);
});

it("retains header accounting through new work and releases it on disposal", async () => {
  const budget = new Budget();
  const replay = new PromiseReplay();
  replay.attachBudget(budget);
  await replay.track(Promise.resolve(7));
  expect(budget.currentDataSize).toBe(3);
  replay.recordSerializedImportedPromises([1]);
  expect(budget.currentDataSize).toBe(4);
  await replay.track(Promise.resolve(8));
  expect(budget.currentDataSize).toBe(7);
  replay.beginCallback("callback");
  expect(budget.currentDataSize).toBe(11);
  await replay.beforeNode(1);
  expect(budget.currentDataSize).toBe(12);
  replay.dispose();
  expect(budget.currentDataSize).toBe(0);
});

it("does not publish a new header when its retained allocation fails", async () => {
  const budget = new Budget({ dataSize: 3 });
  const replay = new PromiseReplay();
  replay.attachBudget(budget);
  await replay.track(Promise.resolve(7));
  expect(() => replay.recordSerializedImportedPromises([1])).toThrow(SandboxError);
  expect(replay.snapshot()).not.toHaveProperty("importedPromises");
  expect(budget.currentDataSize).toBe(3);
});
