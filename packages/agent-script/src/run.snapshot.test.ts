import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { dump } = await import("./dump.js");
const { createSandboxClosure, createSandboxPromise } = await import("./interp/values.js");
const { makeAgentModule } = await import("./modules/agent.js");
const { run } = await import("./run.js");

describe("run snapshot checkpointing", () => {
  beforeEach(() => {
    vol.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes the current snapshot at the next yield after the interval elapses", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let waitCalls = 0;

    const result = run(
      ["return await (async () => { await wait(); await wait(); return Math.random(); })();"].join(
        "\n"
      ),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () =>
              createSandboxPromise((waitCalls += 1) === 1 ? first.promise : second.promise),
            name: "wait"
          })
        },
        randomSeed: 123,
        snapshotPath: "/checkpoints/agent-script.json"
      }
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(vol.existsSync("/checkpoints/agent-script.json")).toBe(false);

    vi.advanceTimersByTime(30_000);
    first.resolve("alpha");
    await flushMicrotasks();

    second.resolve("omega");
    const finished = await result;

    expect(finished).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });

    const checkpoint = JSON.parse(
      vol.readFileSync("/checkpoints/agent-script.json", "utf8") as string
    ) as {
      random?: {
        seed: number;
        state: number;
      };
    };

    expect(checkpoint).toMatchObject({
      random: {
        seed: 123
      }
    });
    expect(checkpoint.random?.state).not.toBe(
      finished.ok ? finished.snapshot.random?.state : undefined
    );
  });

  it("does not write a checkpoint when the interval elapses but execution finishes before another yield", async () => {
    const first = createDeferred<string>();
    let waitCalls = 0;

    const result = run("return await wait();", {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => {
            waitCalls += 1;
            return createSandboxPromise(first.promise);
          },
          name: "wait"
        })
      },
      snapshotPath: "/checkpoints/agent-script.json"
    });

    await flushMicrotasks();
    expect(waitCalls).toBe(1);
    expect(vol.existsSync("/checkpoints/agent-script.json")).toBe(false);

    vi.advanceTimersByTime(30_000);
    first.resolve("done");

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
    expect(vol.existsSync("/checkpoints/agent-script.json")).toBe(false);
  });

  it("resolves dump() with the next yielded snapshot when requested mid-run", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let waitCalls = 0;

    const result = run(
      ["return await (async () => { await wait(); await wait(); return 'done'; })();"].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () =>
              createSandboxPromise((waitCalls += 1) === 1 ? first.promise : second.promise),
            name: "wait"
          })
        }
      }
    );

    await flushMicrotasks();
    expect(waitCalls).toBe(1);

    const dumpPromise = dump(result);
    const onDump = vi.fn();
    void dumpPromise.then(onDump);

    await flushMicrotasks();
    expect(onDump).not.toHaveBeenCalled();

    first.resolve("alpha");
    await flushMicrotasks();

    expect(waitCalls).toBe(2);
    expect(onDump).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onDump.mock.calls[0][0] as string)).toMatchObject({
      bindings: {
        wait: {
          async: true,
          kind: "fn",
          name: "wait"
        }
      },
      sourceHash: expect.any(String)
    });

    second.resolve("omega");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });

  it("waits for a later yield when dump() is requested again", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const third = createDeferred<string>();
    let waitCalls = 0;

    const result = run(
      ["await wait();", "await wait();", "await wait();", "return 'done';"].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => {
              waitCalls += 1;

              if (waitCalls === 1) {
                return createSandboxPromise(first.promise);
              }

              if (waitCalls === 2) {
                return createSandboxPromise(second.promise);
              }

              return createSandboxPromise(third.promise);
            },
            name: "wait"
          })
        }
      }
    );

    await flushMicrotasks();
    expect(waitCalls).toBe(1);

    const firstDump = dump(result);
    first.resolve("alpha");
    const firstSnapshot = JSON.parse(await firstDump) as {
      sourceHash: string;
    };

    expect(waitCalls).toBe(2);

    const secondDump = dump(result);
    const onSecondDump = vi.fn();
    void secondDump.then(onSecondDump);

    await flushMicrotasks();
    expect(onSecondDump).not.toHaveBeenCalled();

    second.resolve("beta");
    const secondSnapshot = JSON.parse(await secondDump) as {
      sourceHash: string;
    };

    expect(waitCalls).toBe(3);
    expect(withoutPendingAwaits(secondSnapshot)).toEqual(withoutPendingAwaits(firstSnapshot));
    expect(secondSnapshot.pendingAwaits).toEqual([
      expect.objectContaining({
        nodeId: expect.any(Number)
      })
    ]);

    third.resolve("gamma");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });

  it("rejects dump() after the run has already failed", async () => {
    const failure = new Error("boom");
    const result = run("return await wait();", {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.reject(failure)),
          name: "wait"
        })
      }
    });

    await expect(result).rejects.toMatchObject({
      message: "boom"
    });
    await expect(dump(result)).rejects.toMatchObject({
      message: "boom"
    });
  });

  it("records snapshot.saved otel events on yielded agent spawn snapshots", async () => {
    const first = createDeferred<{
      exitCode: number;
      stdout: string;
      stderr: string;
      summary: string;
      durationMs: number;
    }>();
    const events: Array<{ attrs: Record<string, unknown> | undefined; name: string }> = [];
    const sink = {
      startSpan: vi.fn(() => ({
        setAttribute: vi.fn(),
        addEvent: vi.fn((name: string, attrs?: Record<string, unknown>) => {
          events.push({ name, attrs });
        }),
        end: vi.fn()
      })),
      recordException: vi.fn()
    };

    const result = run(
      [
        'import { spawn } from "agent";',
        'await spawn("codex", { prompt: "Inspect." });',
        "return 'done';"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(vi.fn(() => first.promise))
        },
        otelSink: sink,
        snapshotPath: "/checkpoints/agent-script.json"
      }
    );

    await flushMicrotasks();
    first.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "finished",
      durationMs: 1
    });

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
    expect(events).toContainEqual({
      name: "snapshot.saved",
      attrs: {
        iteration: 1
      }
    });
  });
});

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

async function flushMicrotasks(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function withoutPendingAwaits<TSnapshot extends { pendingAwaits?: unknown }>(
  snapshot: TSnapshot
): Omit<TSnapshot, "pendingAwaits"> {
  const { pendingAwaits: ignoredPendingAwaits, ...rest } = snapshot;
  void ignoredPendingAwaits;
  return rest;
}
