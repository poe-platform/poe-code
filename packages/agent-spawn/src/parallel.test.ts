import { describe, expect, it, vi } from "vitest";

import { createSpawnParallel } from "./parallel.js";
import { spawn } from "./spawn.js";
import type { AcpEvent } from "./acp/types.js";
import type { SpawnResult } from "./types.js";

type TestHandle = {
  events: AsyncIterable<AcpEvent>;
  result: Promise<SpawnResult>;
};

type TupleOptions = {
  prompt: string;
  signal?: AbortSignal;
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
  it.each(["parent", "tuple"])(
    "preserves %s cancellation reasons in forwarded signals",
    async (source) => {
      for (const reason of [new Error("stop"), null, false, "stop"]) {
        for (const preAborted of [false, true]) {
          const controller = new AbortController();
          const signals: AbortSignal[] = [];
          const parallel = createSpawnParallel<string, TupleOptions, SpawnResult>(
            (_service, options) => {
              const signal = options.signal!;
              signals.push(signal);
              return {
                events: emptyEvents(),
                result: new Promise((_resolve, reject) => {
                  if (signal.aborted) reject(signal.reason);
                  else
                    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                })
              };
            }
          );
          if (preAborted) controller.abort(reason);
          const promise = parallel(
            [
              [
                "codex",
                { prompt: "Run", ...(source === "tuple" ? { signal: controller.signal } : {}) }
              ]
            ],
            source === "parent" ? { signal: controller.signal } : {}
          );
          controller.abort(reason);
          await expect(promise).rejects.toBe(reason);
          for (const signal of signals) expect(signal.reason).toBe(reason);
        }
      }
    }
  );

  const falsyReasons = [
    { label: "undefined", reason: undefined },
    { label: "null", reason: null },
    { label: "false", reason: false },
    { label: "zero", reason: 0 },
    { label: "empty string", reason: "" },
    { label: "NaN", reason: NaN },
    { label: "bigint zero", reason: 0n },
    { label: "negative zero", reason: -0 }
  ];

  describe.each([
    {
      source: "result rejection",
      createHandle: (reason: unknown): TestHandle => ({
        events: emptyEvents(),
        result: Promise.reject(reason)
      })
    },
    {
      source: "synchronous throw",
      createHandle: (reason: unknown): TestHandle => {
        throw reason;
      }
    },
    {
      source: "event stream rejection",
      createHandle: (reason: unknown): TestHandle => ({
        events: (async function* (): AsyncIterable<AcpEvent> {
          yield await Promise.reject<AcpEvent>(reason);
        })(),
        result: Promise.resolve(result(0))
      })
    }
  ])("falsy $source", ({ createHandle }) => {
    it.each(falsyReasons)("rejects with $label from a thunk", async ({ reason }) => {
      const queued = vi.fn((): TestHandle => ({
        events: emptyEvents(),
        result: Promise.resolve(result(1))
      }));

      await expect(
        spawn.parallel([() => createHandle(reason), queued], { maxConcurrent: 1 })
      ).rejects.toBe(reason);

      expect(queued).not.toHaveBeenCalled();
    });

    it.each(falsyReasons)("rejects with $label from a tuple", async ({ reason }) => {
      const spawnOnce = vi.fn(() => createHandle(reason));
      const parallel = createSpawnParallel<string, TupleOptions, SpawnResult>(spawnOnce);

      await expect(
        parallel(
          [
            ["codex", { prompt: "failing" }],
            ["codex", { prompt: "queued" }]
          ],
          { maxConcurrent: 1 }
        )
      ).rejects.toBe(reason);

      expect(spawnOnce).toHaveBeenCalledTimes(1);
    });

    it("aggregates every falsy reason and continues when failFast is false", async () => {
      const successful = vi.fn((): TestHandle => ({
        events: emptyEvents(),
        result: Promise.resolve(result(8))
      }));
      const promise = spawn.parallel(
        [...falsyReasons.map(({ reason }) => () => createHandle(reason)), successful],
        { maxConcurrent: 1, failFast: false }
      );

      await expect(promise).rejects.toBeInstanceOf(AggregateError);
      await expect(promise).rejects.toHaveProperty(
        "errors",
        falsyReasons.map(({ reason }) => reason)
      );
      expect(successful).toHaveBeenCalledTimes(1);
    });
  });

  it.each(falsyReasons)("preserves $label after a peer rejects on abort", async ({ reason }) => {
    const pending = deferred<SpawnResult>();
    const abortError = new Error("peer aborted");
    abortError.name = "AbortError";
    const onAbort = vi.fn(() => pending.reject(abortError));
    const queued = vi.fn((): TestHandle => ({
      events: emptyEvents(),
      result: Promise.resolve(result(2))
    }));

    await expect(
      spawn.parallel(
        [
          (): TestHandle => ({ events: emptyEvents(), result: Promise.reject(reason) }),
          (signal?: AbortSignal): TestHandle => {
            signal?.addEventListener("abort", onAbort, { once: true });
            return { events: emptyEvents(), result: pending.promise };
          },
          queued
        ],
        { maxConcurrent: 2 }
      )
    ).rejects.toBe(reason);

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(queued).not.toHaveBeenCalled();
  });

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

  it("returns failed results with check=false even when failFast is true", async () => {
    const spawnOnce = vi.fn(
      (): TestHandle => ({
        events: emptyEvents(),
        result: Promise.resolve(result(1, 7))
      })
    );
    const parallel = createSpawnParallel(spawnOnce);

    await expect(
      parallel(
        [
          ["agent", {}],
          ["agent", {}]
        ],
        { check: false, failFast: true, maxConcurrent: 1 }
      )
    ).resolves.toEqual([result(1, 7), result(1, 7)]);
    expect(spawnOnce).toHaveBeenCalledTimes(2);
  });

  it("checks complete results after collecting when failFast is false", async () => {
    const spawnOnce = vi.fn(
      (): TestHandle => ({
        events: emptyEvents(),
        result: Promise.resolve(result(1, 7))
      })
    );
    const parallel = createSpawnParallel(spawnOnce);

    await expect(
      parallel(
        [
          ["agent", {}],
          ["agent", {}]
        ],
        { check: true, failFast: false, maxConcurrent: 1 }
      )
    ).rejects.toMatchObject({
      name: "SpawnParallelError",
      index: 0,
      result: result(1, 7),
      results: [result(1, 7), result(1, 7)]
    });
    expect(spawnOnce).toHaveBeenCalledTimes(2);
  });

  it.each([null, "false", 0, {}, []])("rejects invalid check=%j before starting", async (check) => {
    const spawnOnce = vi.fn(
      (): TestHandle => ({
        events: emptyEvents(),
        result: Promise.resolve(result(1))
      })
    );
    const parallel = createSpawnParallel(spawnOnce);

    await expect(parallel([["agent", {}]], { check: check as never })).rejects.toThrow(
      "check must be a boolean"
    );
    expect(spawnOnce).not.toHaveBeenCalled();
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

  it("uses the default maxConcurrent of 4 for tuple calls", async () => {
    let active = 0;
    let maxActive = 0;
    const parallel = createSpawnParallel<string, TupleOptions, SpawnResult>(
      (_service, options) => {
        active += 1;
        maxActive = Math.max(maxActive, active);

        return {
          events: emptyEvents(),
          result: new Promise<SpawnResult>((resolve) => {
            setTimeout(() => {
              active -= 1;
              resolve(result(Number(options.prompt)));
            }, 5);
          })
        };
      }
    );

    const results = await parallel(
      Array.from({ length: 6 }, (_, index) => ["codex", { prompt: String(index) }] as const)
    );

    expect(results.map((item) => item.stdout)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(maxActive).toBe(4);
  });

  it("aborts tuple calls when the parent signal aborts", async () => {
    const parent = new AbortController();
    const call = new AbortController();
    const forwardedSignals: AbortSignal[] = [];
    const parallel = createSpawnParallel<string, TupleOptions, SpawnResult>(
      (_service, options) => {
        forwardedSignals.push(options.signal as AbortSignal);
        return {
          events: emptyEvents(),
          result: new Promise<SpawnResult>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new Error(`aborted ${options.prompt}`));
            });
          })
        };
      }
    );

    const callPromise = parallel(
      [
        ["codex", { prompt: "parent" }],
        ["codex", { prompt: "call", signal: call.signal }]
      ],
      { maxConcurrent: 2, signal: parent.signal }
    );

    await vi.waitFor(() => {
      expect(forwardedSignals).toHaveLength(2);
    });
    expect(forwardedSignals.every((signal) => !signal.aborted)).toBe(true);

    parent.abort();

    await expect(callPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(forwardedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("aborts the parallel group when a tuple call signal aborts", async () => {
    const call = new AbortController();
    const aborted: string[] = [];
    const parallel = createSpawnParallel<string, TupleOptions, SpawnResult>(
      (_service, options) => ({
        events: emptyEvents(),
        result: new Promise<SpawnResult>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            aborted.push(options.prompt);
            reject(new Error(`aborted ${options.prompt}`));
          });
        })
      })
    );

    const promise = parallel(
      [
        ["codex", { prompt: "group" }],
        ["codex", { prompt: "call", signal: call.signal }]
      ],
      { maxConcurrent: 2 }
    );

    call.abort();

    await expect(promise).rejects.toThrow("aborted call");
    expect(aborted).toEqual(["call", "group"]);
  });
});
