import { describe, expect, it } from "vitest";
import { SandboxJobQueue, runAsyncPrefix, runPromiseJob, suspendJob } from "./jobs.js";

describe("sandbox execution jobs", () => {
  it("keeps FIFO order when running jobs enqueue another batch", async () => {
    const queue = new SandboxJobQueue();
    const order: number[] = [];
    const nested: Promise<void>[] = [];
    const jobs = [0, 1, 2].map((index) =>
      queue.run(() => {
        order.push(index);
        if (index === 1) {
          nested.push(
            queue.run(() => {
              order.push(3);
            })
          );
          nested.push(
            queue.run(() => {
              order.push(4);
            })
          );
        }
      })
    );
    await Promise.all(jobs);
    await Promise.all(nested);
    await queue.drain();
    expect(order).toEqual([0, 1, 2, 3, 4]);
    await queue.run(() => {
      order.push(5);
    });
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("releases ownership after a rejection and drains subsequent jobs", async () => {
    const queue = new SandboxJobQueue();
    const reason = new Error("job failed");
    const failure = queue.run(() => {
      throw reason;
    });
    const next = queue.run(() => "next");
    await expect(failure).rejects.toBe(reason);
    await expect(next).resolves.toBe("next");
    await queue.drain();
    await expect(queue.run(() => "reused")).resolves.toBe("reused");
  });

  it("reacquires a suspended job after already queued jobs", async () => {
    const queue = new SandboxJobQueue();
    const order: string[] = [];
    const parent = queue.run(async () => {
      order.push("parent");
      const child = runAsyncPrefix(async () => {
        order.push("prefix");
        await suspendJob(Promise.resolve());
        order.push("child resumed");
      });
      const sibling = runPromiseJob(() => {
        order.push("sibling");
      });
      await suspendJob(Promise.all([child, sibling]));
      order.push("parent resumed");
    });
    const outside = queue.run(() => {
      order.push("outside");
    });
    await Promise.all([parent, outside]);
    await queue.drain();
    expect(order).toEqual([
      "parent",
      "prefix",
      "outside",
      "sibling",
      "child resumed",
      "parent resumed"
    ]);
  });
});
