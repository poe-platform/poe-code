import { expect, it } from "vitest";
import { PromiseReplay } from "./promise-replay.js";

it("counts an imported-only settlement toward replay completion", async () => {
  const replay = new PromiseReplay({ version: 1, steps: 0, promises: 1, settlements: [{ id: 1, step: 0 }] });
  replay.reserveImportedPromise(1);
  const value = {};
  await expect(replay.restoreImportedPromise(1, Promise.resolve(7), value)).resolves.toBe(7);
  expect(replay.identifyPromise(value)).toBe(1);
  expect(replay.waitForLiveExecution()).toBeUndefined();
});

it("propagates an existing replay failure to newly restored imported Promises", async () => {
  const replay = new PromiseReplay({ version: 1, steps: 0, promises: 1, settlements: [{ id: 1, step: 0 }] });
  replay.reserveImportedPromise(1);
  const error = new Error("stopped");
  replay.fail(error);
  await expect(replay.restoreImportedPromise(1, Promise.resolve(7), {})).rejects.toBe(error);
});

it.each([0, -1, 1.5, 3, NaN, Infinity])("rejects invalid reserved imported identity %s", id => {
  const replay = new PromiseReplay({ version: 1, steps: 0, promises: 2, settlements: [] });
  expect(() => replay.reserveImportedPromise(id)).toThrow(TypeError);
});

it("rejects duplicate scheduling reservations", () => {
  const replay = new PromiseReplay({ version: 1, steps: 0, promises: 1, settlements: [] });
  replay.reserveImportedPromise(1);
  expect(() => replay.reserveImportedPromise(1)).toThrow(TypeError);
});
