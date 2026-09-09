import { expect, it, vi } from "vitest";
import { runResources, withRunResources } from "./resources.js";

it("reports an asynchronous owned-job failure and cancels its execution owner", async () => {
  const failure = new Error("cleanup job failed");
  const closed = vi.fn(async () => {});
  await expect(withRunResources(undefined, async () => {
    const owner = runResources.getStore()!;
    owner.add(closed);
    await Promise.resolve();
    owner.reportError!(failure);
    expect(owner.signal.aborted).toBe(true);
    expect(owner.signal.reason).toBe(failure);
    return "cannot report success";
  })).rejects.toBe(failure);
  expect(closed).toHaveBeenCalledTimes(1);
});

it("preserves the first owned-job failure through subsequent cancellation errors", async () => {
  const failure = new Error("original failure");
  await expect(withRunResources(undefined, async () => {
    const owner = runResources.getStore()!;
    owner.reportError!(failure);
    owner.reportError!(new Error("later failure"));
    throw new Error("operation interrupted");
  })).rejects.toBe(failure);
});
