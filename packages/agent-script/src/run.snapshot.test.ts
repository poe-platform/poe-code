import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { dump } = await import("./dump.js");
const { createSandboxClosure, createSandboxPromise } = await import("./interp/values.js");
const { makeAgentModule } = await import("./modules/agent.js");
const { restore } = await import("./restore.js");
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
    vol.mkdirSync("/checkpoints");
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

  it("continues execution after a scheduled snapshot write fails and surfaces the write error at finish", async () => {
    const diskFull = new Error("no space left on device");
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let waitCalls = 0;

    const result = run("await wait(); await wait(); return 'done';", {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => {
            waitCalls += 1;
            return createSandboxPromise(waitCalls === 1 ? first.promise : second.promise);
          },
          name: "wait"
        })
      },
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async write() {
          throw diskFull;
        },
        async remove() {}
      }
    });

    await flushMicrotasks();
    expect(waitCalls).toBe(1);

    vi.advanceTimersByTime(30_000);
    first.resolve("alpha");
    await flushMicrotasks();

    expect(waitCalls).toBe(2);

    second.resolve("omega");
    await expect(result).rejects.toBe(diskFull);
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

  it("restores a snapshot taken before the first await and returns the original value", async () => {
    const source = ["const value = await wait();", 'return value.concat(":done");'].join("\n");
    const first = createDeferred<string>();
    const result = run(source, {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(first.promise),
          name: "wait"
        })
      }
    });
    const snapshotPromise = dump(result);

    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);

    first.resolve("original");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "original:done"
    });

    await expect(
      run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve("original")),
            name: "wait"
          })
        },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "original:done"
    });
  });

  it("restores a snapshot taken after a loop let mutation with the mutated binding", async () => {
    const source = [
      "let total = 0;",
      "for (let i = 0; i < 3; i = i + 1) {",
      "  total = total + i;",
      "  await wait();",
      "}",
      "return total;"
    ].join("\n");
    const waits = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
    let waitCalls = 0;
    const result = run(source, {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(waits[waitCalls++]?.promise ?? Promise.resolve()),
          name: "wait"
        })
      }
    });

    const firstSnapshot = JSON.parse(await dump(result)) as {
      bindings: Record<string, unknown>;
    };
    expect(firstSnapshot.bindings).toMatchObject({
      i: 0,
      total: 0
    });
    await flushMicrotasks();
    const snapshotPromise = dump(result);
    waits[0]?.resolve();
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise) as {
      bindings: Record<string, unknown>;
    };
    const restored = restore(snapshot, { source }) as typeof snapshot;

    expect(restored.bindings).toMatchObject({
      i: 1,
      total: 0
    });

    waits[1]?.resolve();
    waits[2]?.resolve();
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
    await expect(
      run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve()),
            name: "wait"
          })
        },
        snapshot: restored
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("restores a background dump from a bound generator loop", async () => {
    const source = [
      "const output = [];",
      "function* values() { yield 1; yield 2; yield 3; yield 4; }",
      "const iterator = values();",
      "for (const value of iterator) { output.push(value); }",
      "return output;"
    ].join("\n");
    const result = run(source);
    const snapshot = JSON.parse(await dump(result));

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3, 4]
    });
    await expect(run(source, { snapshot: restore(snapshot, { source }) })).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3, 4]
    });
  });

  it("restores from a mid-try snapshot and lets the original catch handle the throw", async () => {
    const source = [
      "try {",
      "  await wait();",
      '  throw Error("boom");',
      "} catch (error) {",
      '  return "caught:".concat(error.message);',
      "}"
    ].join("\n");
    const first = createDeferred<void>();
    const result = run(source, {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(first.promise),
          name: "wait"
        })
      }
    });
    const snapshotPromise = dump(result);

    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    first.resolve();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "caught:boom"
    });
    await expect(
      run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve()),
            name: "wait"
          })
        },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "caught:boom"
    });
  });

  it("restores a snapshot from inside finally and preserves the pending return", async () => {
    const source = ["try {", '  return "body";', "} finally {", "  await wait();", "}"].join("\n");
    const first = createDeferred<void>();
    const result = run(source, {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(first.promise),
          name: "wait"
        })
      }
    });
    const snapshotPromise = dump(result);

    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    first.resolve();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "body"
    });
    await expect(
      run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve()),
            name: "wait"
          })
        },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "body"
    });
  });

  it("restores while two unawaited promises are pending and keeps the result order", async () => {
    const source = [
      'const left = later("left");',
      'const right = later("right");',
      "const values = await Promise.all([left, right]);",
      "return JSON.stringify(values);"
    ].join("\n");
    const firstRun = {
      left: createDeferred<string>(),
      right: createDeferred<string>()
    };
    const result = run(source, {
      bindings: {
        later: createSandboxClosure({
          async: true,
          call: ([label]) =>
            createSandboxPromise(label === "left" ? firstRun.left.promise : firstRun.right.promise),
          name: "later"
        })
      }
    });
    const snapshotPromise = dump(result);

    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    firstRun.left.resolve("left");
    firstRun.right.resolve("right");

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["left", "right"])
    });

    const secondRun = {
      left: createDeferred<string>(),
      right: createDeferred<string>()
    };
    const resumed = run(source, {
      bindings: {
        later: createSandboxClosure({
          async: true,
          call: ([label]) =>
            createSandboxPromise(
              label === "left" ? secondRun.left.promise : secondRun.right.promise
            ),
          name: "later"
        })
      },
      snapshot: restore(snapshot, { source })
    });

    await flushMicrotasks();
    secondRun.left.resolve("left");
    secondRun.right.resolve("right");
    await expect(resumed).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["left", "right"])
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
