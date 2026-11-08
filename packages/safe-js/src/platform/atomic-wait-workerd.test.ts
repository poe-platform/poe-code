import { afterEach, expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { waitForAtomicValue } from "./atomic-wait-workerd.js";

afterEach(() => vi.unstubAllGlobals());

it("preserves synchronous native wait results and arguments", async () => {
  const result = { async: false as const, value: "not-equal" };
  const waitAsync = vi.fn(() => result);
  vi.stubGlobal("Atomics", { waitAsync });
  const view = new Int32Array(2);
  expect(await waitForAtomicValue(view, 1, 4, Infinity, new Budget())).toBe(result);
  expect(waitAsync).toHaveBeenCalledWith(view, 1, 4, Infinity);
});

it("preserves asynchronous native promises with a monotonic start time", async () => {
  const value = Promise.resolve("ok");
  vi.stubGlobal("Atomics", { waitAsync: () => ({ async: true, value }) });
  const before = performance.now();
  const result = await waitForAtomicValue(new Int32Array(1), 0, 0, Infinity, new Budget());
  expect(result.async).toBe(true);
  expect(result.value).toBe(value);
  if (!result.async) throw new Error("Expected an asynchronous wait.");
  expect(result.startedAt).toBeGreaterThanOrEqual(before);
  expect(result.startedAt).toBeLessThanOrEqual(performance.now());
});

it("reports an unavailable native wait API", async () => {
  vi.stubGlobal("Atomics", {});
  await expect(waitForAtomicValue(new Int32Array(1), 0, 0, Infinity, new Budget()))
    .rejects.toThrow("This host does not support Atomics.waitAsync.");
});
