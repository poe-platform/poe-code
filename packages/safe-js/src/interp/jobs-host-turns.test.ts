import { setImmediate as hostTurn } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { SandboxJobQueue } from "./jobs.js";

it("delivers a pending host turn after a costly node before the node quota is exhausted", async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const queue = new SandboxJobQueue();
  queue.enableControl();
  try {
    let delivered = false;
    const pending = hostTurn().then(() => {
      delivered = true;
    });
    await queue.run(async () => {
      expect(SandboxJobQueue.checkpoint()).toBeUndefined();
      // Model time spent in a node's retained-graph reconciliation.
      now += 1000;
      const checkpoint = SandboxJobQueue.checkpoint();
      expect(checkpoint).toBeInstanceOf(Promise);
      await checkpoint;
      expect(delivered).toBe(true);
      expect(SandboxJobQueue.checkpoint()).toBeUndefined();
    });
    await pending;
  } finally {
    queue.finish();
    clock.mockRestore();
  }
});

it("preserves FIFO guest ownership while letting the host run after costly work", async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const queue = new SandboxJobQueue();
  queue.enableControl();
  const order: string[] = [];
  try {
    const host = hostTurn().then(() => {
      order.push("host");
    });
    const first = queue.run(async () => {
      order.push("first prefix");
      expect(SandboxJobQueue.checkpoint()).toBeUndefined();
      now += 1000;
      const checkpoint = SandboxJobQueue.checkpoint();
      expect(checkpoint).toBeInstanceOf(Promise);
      await checkpoint;
      order.push("first end");
    });
    const second = queue.run(() => {
      order.push("second");
    });
    await Promise.all([first, second, host]);
    expect(order).toEqual(["first prefix", "host", "first end", "second"]);
  } finally {
    queue.finish();
    clock.mockRestore();
  }
});

it("retains the node quota fallback when the host clock moves backwards", async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const queue = new SandboxJobQueue();
  queue.enableControl();
  try {
    now = 0;
    await queue.run(async () => {
      for (let index = 0; index < 4095; index++)
        expect(SandboxJobQueue.checkpoint()).toBeUndefined();
      const checkpoint = SandboxJobQueue.checkpoint();
      expect(checkpoint).toBeInstanceOf(Promise);
      await checkpoint;
    });
  } finally {
    queue.finish();
    clock.mockRestore();
  }
});
