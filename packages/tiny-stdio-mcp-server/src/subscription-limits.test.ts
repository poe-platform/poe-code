import { describe, expect, it, vi } from "vitest";
import { SubscriptionRegistry } from "./subscriptions.js";

describe("subscription URI admission", () => {
  it.each(
    [
      Array.from({ length: 1025 }, () => "memo://item"),
      ["memo://" + "x".repeat(8192)],
      ["relative/path"],
      [""],
      [" file:///data"],
      ["file:///bad%zz"],
      ["file:///a\nb"]
    ].map((uris) => [uris])
  )("rejects invalid or excessive URI filters before acknowledgement", async (uris) => {
    const listener = vi.fn();
    const registry = new SubscriptionRegistry(listener, true, true);
    const controller = new AbortController();
    const pending = registry.listen(1, { resourceSubscriptions: uris }, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ error: { code: -32602 } });
    expect(listener).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });
});
