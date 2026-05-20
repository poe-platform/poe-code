import { afterEach, describe, expect, it, vi } from "vitest";

import { createEventCollector } from "./event-collector.js";

describe("createEventCollector", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records events chronologically and returns a frozen snapshot", () => {
    const collector = createEventCollector();

    collector.onEvent({ type: "tick_started", at: "2026-01-01T00:00:00.000Z" });
    collector.onEvent({ type: "validation_failed", reason: "list_not_found" });

    expect(collector.events).toEqual([
      { type: "tick_started", at: "2026-01-01T00:00:00.000Z" },
      { type: "validation_failed", reason: "list_not_found" }
    ]);
    expect(collector.snapshot()).toEqual(collector.events);
    expect(Object.isFrozen(collector.snapshot())).toBe(true);
    expect(collector.snapshot()).not.toBe(collector.events);
  });

  it("resolves waitFor when a matching event is already recorded or later arrives", async () => {
    vi.useFakeTimers();
    const collector = createEventCollector();

    collector.onEvent({
      type: "dispatch",
      task_id: "tasks/one",
      qualified_id: "tasks/one",
      workspace: "/w"
    });

    await expect(
      collector.waitFor((event) => event.type === "dispatch", { timeoutMs: 1000 })
    ).resolves.toMatchObject({ type: "dispatch" });

    const pending = collector.waitFor((event) => event.type === "worker_exit", {
      timeoutMs: 1000
    });
    collector.onEvent({ type: "worker_exit", task_id: "tasks/one", reason: "normal" });

    await expect(pending).resolves.toMatchObject({ type: "worker_exit" });
  });

  it("resolves matching waiters once and clears their timeouts", async () => {
    vi.useFakeTimers();
    const collector = createEventCollector();
    const first = collector.waitFor((event) => event.type === "worker_exit", {
      timeoutMs: 1_000
    });
    const second = collector.waitFor((event) => event.type === "worker_exit", {
      timeoutMs: 1_000
    });

    collector.onEvent({ type: "worker_exit", task_id: "tasks/one", reason: "normal" });

    await expect(first).resolves.toMatchObject({ type: "worker_exit" });
    await expect(second).resolves.toMatchObject({ type: "worker_exit" });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("rejects waitFor on virtual timer timeout without waiting for real time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const collector = createEventCollector();
    const startedAt = Date.now();

    const pending = collector.waitFor((event) => event.type === "worker_exit", {
      timeoutMs: 5_000
    });
    await vi.advanceTimersByTimeAsync(4_999);

    let settled = false;
    pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).rejects.toThrow("Timed out waiting for maestro event after 5000ms.");
    expect(Date.now() - startedAt).toBe(5_000);
  });
});
