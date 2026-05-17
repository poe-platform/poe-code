import { describe, expect, it, vi } from "vitest";

import { spawn } from "./spawn.js";
import type { AcpEvent } from "./acp/types.js";
import type { SpawnResult } from "./types.js";

type TestHandle = {
  events: AsyncIterable<AcpEvent>;
  result: Promise<SpawnResult>;
};

const emptyEvents = async function* (): AsyncIterable<AcpEvent> {};

function result(id: number, exitCode = 0): SpawnResult {
  return {
    stdout: String(id),
    stderr: exitCode === 0 ? "" : `failed ${id}`,
    exitCode,
    usage: {
      inputTokens: id,
      outputTokens: id * 2
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("spawn.parallel()", () => {
  it("runs at most maxConcurrent spawns at a time", async () => {
    let active = 0;
    let maxActive = 0;

    const calls = Array.from({ length: 5 }, (_, index) => () => {
      active += 1;
      maxActive = Math.max(maxActive, active);

      return {
        events: emptyEvents(),
        result: new Promise<SpawnResult>((resolve) => {
          setTimeout(() => {
            active -= 1;
            resolve(result(index));
          }, 5);
        })
      };
    });

    const results = await spawn.parallel(calls, { maxConcurrent: 2 });

    expect(results).toHaveLength(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("returns successful results in input order", async () => {
    const calls = [30, 10, 20].map((delayMs, index) => () => ({
      events: emptyEvents(),
      result: new Promise<SpawnResult>((resolve) => {
        setTimeout(() => {
          resolve(result(index));
        }, delayMs);
      })
    }));

    const results = await spawn.parallel(calls, { maxConcurrent: 3 });

    expect(results.map((item) => item.stdout)).toEqual(["0", "1", "2"]);
    expect(results.map((item) => item.usage?.inputTokens)).toEqual([0, 1, 2]);
  });

  it("aborts in-flight spawns and rejects with the failing result when failFast is enabled", async () => {
    const aborted: number[] = [];
    const slow = deferred<SpawnResult>();

    const calls = [
      (signal?: AbortSignal): TestHandle => {
        signal?.addEventListener("abort", () => {
          aborted.push(0);
          slow.reject(new Error("aborted slow spawn"));
        });
        return { events: emptyEvents(), result: slow.promise };
      },
      (): TestHandle => ({
        events: emptyEvents(),
        result: Promise.resolve(result(1, 7))
      }),
      vi.fn((): TestHandle => ({ events: emptyEvents(), result: Promise.resolve(result(2)) }))
    ];

    await expect(spawn.parallel(calls, { maxConcurrent: 2 })).rejects.toMatchObject({
      index: 1,
      result: {
        exitCode: 7,
        stderr: "failed 1"
      }
    });

    expect(aborted).toEqual([0]);
    expect(calls[2]).not.toHaveBeenCalled();
  });

  it("returns all results including failures when failFast is false", async () => {
    const calls = [
      (): TestHandle => ({ events: emptyEvents(), result: Promise.resolve(result(0)) }),
      (): TestHandle => ({ events: emptyEvents(), result: Promise.resolve(result(1, 3)) }),
      (): TestHandle => ({ events: emptyEvents(), result: Promise.resolve(result(2)) })
    ];

    const results = await spawn.parallel(calls, { maxConcurrent: 2, failFast: false });

    expect(results.map((item) => item.exitCode)).toEqual([0, 3, 0]);
  });

  it("returns an empty array without spawning for empty input", async () => {
    const results = await spawn.parallel([], { maxConcurrent: 2 });

    expect(results).toEqual([]);
  });

  it("runs sequentially when maxConcurrent is 1", async () => {
    const order: string[] = [];
    const calls = Array.from({ length: 3 }, (_, index) => () => {
      order.push(`start ${index}`);
      return {
        events: emptyEvents(),
        result: new Promise<SpawnResult>((resolve) => {
          setTimeout(() => {
            order.push(`finish ${index}`);
            resolve(result(index));
          }, 5);
        })
      };
    });

    await spawn.parallel(calls, { maxConcurrent: 1 });

    expect(order).toEqual([
      "start 0",
      "finish 0",
      "start 1",
      "finish 1",
      "start 2",
      "finish 2"
    ]);
  });

  it("aborts in-flight spawns when the parent signal aborts", async () => {
    const parent = new AbortController();
    const aborted: number[] = [];
    let started = 0;
    const allStarted = deferred<void>();

    const calls = Array.from({ length: 3 }, (_, index) => (signal?: AbortSignal) => {
      started += 1;
      if (started === 2) {
        allStarted.resolve();
      }

      const pending = deferred<SpawnResult>();
      signal?.addEventListener("abort", () => {
        aborted.push(index);
        pending.reject(new Error(`aborted ${index}`));
      });

      return { events: emptyEvents(), result: pending.promise };
    });

    const promise = spawn.parallel(calls, { maxConcurrent: 2, signal: parent.signal });
    await allStarted.promise;
    parent.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted).toEqual([0, 1]);
    expect(started).toBe(2);
  });
});
