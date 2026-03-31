import { describe, it, expect, vi } from "bun:test";
import { createRevalidator } from "./background-revalidator.js";

describe("createRevalidator", () => {
  it("executes the revalidation callback", async () => {
    const revalidator = createRevalidator();
    const callback = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("key", callback);
    await revalidator.waitForRevalidation("key");

    expect(callback).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent revalidation requests for the same key", async () => {
    const revalidator = createRevalidator();
    let resolveFirst!: () => void;
    const firstCallback = vi.fn(
      () => new Promise<void>((r) => (resolveFirst = r)),
    );
    const secondCallback = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("key", firstCallback);
    revalidator.trigger("key", secondCallback);

    resolveFirst();
    await revalidator.waitForRevalidation("key");

    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it("allows new revalidation after previous one completes", async () => {
    const revalidator = createRevalidator();
    const firstCallback = vi.fn().mockResolvedValue(undefined);
    const secondCallback = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("key", firstCallback);
    await revalidator.waitForRevalidation("key");

    revalidator.trigger("key", secondCallback);
    await revalidator.waitForRevalidation("key");

    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).toHaveBeenCalledOnce();
  });

  it("silently catches revalidation failures", async () => {
    const revalidator = createRevalidator();
    const callback = vi.fn().mockRejectedValue(new Error("fetch failed"));

    revalidator.trigger("key", callback);
    await revalidator.waitForRevalidation("key");

    expect(callback).toHaveBeenCalledOnce();
  });

  it("tracks independent keys separately", async () => {
    const revalidator = createRevalidator();
    const callbackA = vi.fn().mockResolvedValue(undefined);
    const callbackB = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("a", callbackA);
    revalidator.trigger("b", callbackB);
    await revalidator.waitForRevalidation();

    expect(callbackA).toHaveBeenCalledOnce();
    expect(callbackB).toHaveBeenCalledOnce();
  });

  it("waitForRevalidation resolves immediately when no inflight requests", async () => {
    const revalidator = createRevalidator();

    await revalidator.waitForRevalidation();
    await revalidator.waitForRevalidation("nonexistent");
  });
});
