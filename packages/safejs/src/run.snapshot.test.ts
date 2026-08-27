import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { dump } = await import("./dump.js");
const { digestHostCallArguments, HostCallResumabilityError } =
  await import("./interp/host-call.js");
const { declareHostOperation } = await import("./interp/host-bridge.js");
const { createSandboxClosure, createSandboxPromise } = await import("./interp/values.js");
const { makeAgentModule } = await import("./modules/agent.js");
const { restore } = await import("./restore.js");
const { run } = await import("./run.js");
const { hashSource } = await import("./parse/hash.js");
const { DUMP_FORMAT_VERSION } = await import("./snapshot/dump-format.js");
const { UnsnapshotableValueError } = await import("./snapshot/serialize.js");

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
        snapshotPath: "/checkpoints/SafeJS.json"
      }
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(vol.existsSync("/checkpoints/SafeJS.json")).toBe(false);

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
      vol.readFileSync("/checkpoints/SafeJS.json", "utf8") as string
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
      snapshotPath: "/checkpoints/SafeJS.json"
    });

    await flushMicrotasks();
    expect(waitCalls).toBe(1);
    expect(vol.existsSync("/checkpoints/SafeJS.json")).toBe(false);

    vi.advanceTimersByTime(30_000);
    first.resolve("done");

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
    expect(vol.existsSync("/checkpoints/SafeJS.json")).toBe(false);
  });

  it("continues execution after a scheduled snapshot write fails and surfaces the write error at finish", async () => {
    const diskFull = new Error("no space left on device");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
    expect(warning).toHaveBeenCalledWith("Failed to write failure snapshot.", diskFull);
  });

  it("writes the live bindings before propagating a run failure", async () => {
    const failure = new Error("boom");
    const snapshots: unknown[] = [];
    const result = run("let progress = 0; progress = 2; fail();", {
      bindings: {
        fail: createSandboxClosure({
          call: () => {
            throw failure;
          },
          name: "fail"
        })
      },
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async write(snapshot) {
          snapshots.push(snapshot);
        },
        async remove() {}
      }
    });

    await expect(result).rejects.toMatchObject({
      message: failure.message,
      name: failure.name
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      bindings: {
        progress: 2
      }
    });
  });

  it("skips an unsnapshotable failure snapshot without replacing the run failure", async () => {
    const failure = new Error("boom");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const write = vi.fn(async (snapshot: { bindings: Record<string, unknown> }) => {
      expect(snapshot.bindings).toHaveProperty("iterator");
      throw new UnsnapshotableValueError("bindings.iterator");
    });
    const result = run(
      [
        "function* values() { yield 1; yield 2; }",
        "const iterator = values();",
        "iterator.next();",
        "fail();"
      ].join("\n"),
      {
        bindings: {
          fail: createSandboxClosure({
            call: () => {
              throw failure;
            },
            name: "fail"
          })
        },
        snapshotBackend: {
          async read() {
            return undefined;
          },
          write,
          async remove() {}
        }
      }
    );

    await expect(result).rejects.toMatchObject({
      message: failure.message,
      name: failure.name
    });
    expect(write).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "Skipping failure snapshot: Cannot snapshot a generator suspended mid-iteration; drain or discard it before the await boundary."
    );
  });

  it("logs a failure snapshot write error without replacing the run failure", async () => {
    const failure = new Error("boom");
    const writeFailure = new Error("disk full");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = run("let progress = 1; fail();", {
      bindings: {
        fail: createSandboxClosure({
          call: () => {
            throw failure;
          },
          name: "fail"
        })
      },
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async write() {
          throw writeFailure;
        },
        async remove() {}
      }
    });

    await expect(result).rejects.toMatchObject({
      message: failure.message,
      name: failure.name
    });
    expect(warning).toHaveBeenCalledWith("Failed to write failure snapshot.", writeFailure);
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
    expect(withoutCheckpointPosition(secondSnapshot)).toEqual(
      withoutCheckpointPosition(firstSnapshot)
    );
    expect(secondSnapshot.promiseReplay.steps).toBeGreaterThan(firstSnapshot.promiseReplay.steps);
    expect(secondSnapshot.promiseReplay.promises).toBe(firstSnapshot.promiseReplay.promises + 3);
    expect(secondSnapshot.promiseReplay.settlements).toEqual([
      ...firstSnapshot.promiseReplay.settlements,
      expect.objectContaining({ id: 4 }),
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ id: 6 })
    ]);
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

  it.each([
    {
      name: "shared sibling captures",
      source: `
        let count = 1;
        const increment = () => { count += 1; };
        const read = () => count;
        increment();
        await wait();
        increment();
        return read();
      `,
      expected: 3
    },
    {
      name: "per-iteration bindings",
      source: `
        const readers = [];
        for (let index = 0; index < 8; index += 1) {
          readers.push(() => { index += 10; return index; });
        }
        readers[0]();
        await wait();
        return readers.map((read) => read());
      `,
      expected: [20, 11, 12, 13, 14, 15, 16, 17]
    },
    {
      name: "factory captures and default parameter readers",
      source: `
        const create = (count, read = () => count) => ({
          read,
          add: () => { count += 1; }
        });
        const first = create(5);
        const second = create(10);
        first.add();
        await wait();
        first.add();
        second.add();
        return [first.read(), second.read()];
      `,
      expected: [7, 11]
    },
    {
      name: "escaped arguments objects",
      source: `
        function capture() { return arguments; }
        const args = capture(5, 6);
        args[1] = 9;
        await wait();
        return [args.length, [...args], Object.keys(args)];
      `,
      expected: [2, [5, 9], ["0", "1"]]
    },
    {
      name: "recursive reassigned closures",
      source: `
        let recurse;
        let count = 0;
        recurse = (depth) => { count += 1; return depth === 0 ? count : recurse(depth - 1); };
        recurse(3);
        await wait();
        return recurse(3);
      `,
      expected: 8
    }
  ])("preserves $name when restoring an await checkpoint", async ({ source, expected }) => {
    const pending = createDeferred<void>();
    const result = run(source, {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(pending.promise),
          name: "wait"
        })
      }
    });
    const snapshot = JSON.parse(await dump(result));
    pending.resolve();
    await expect(result).resolves.toMatchObject({ ok: true, returnValue: expected });
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
    ).resolves.toMatchObject({ ok: true, returnValue: expected });
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
        snapshotPath: "/checkpoints/SafeJS.json"
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

  it("does not re-issue a non-idempotent call after process death", async () => {
    const source = 'import { charge } from "payments"; return await charge("order-1");';
    const deferred = createDeferred<string>();
    let invocations = 0;
    const charge = declareHostOperation(async () => {
      invocations += 1;
      return deferred.promise;
    }, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);

    await expect(
      run(source, {
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).rejects.toMatchObject({
      action: "external-reconciliation",
      name: "HostCallResumabilityError"
    });
    expect(invocations).toBe(1);

    deferred.resolve("charged");
    await expect(first).resolves.toMatchObject({ returnValue: "charged" });
  });

  it("accepts only a fully matching external result proof", async () => {
    const source = 'import { charge } from "payments"; return await charge("order-1");';
    const deferred = createDeferred<string>();
    let invocations = 0;
    const charge = declareHostOperation(async () => {
      invocations += 1;
      return deferred.promise;
    }, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    const call = snapshot.hostCalls[0];

    await expect(
      run(source, {
        hostCallResumeProvider: () => ({
          callId: `${call.id}-stale`,
          sourceHash: call.sourceHash,
          moduleId: call.moduleId,
          operation: call.operation,
          argumentDigest: call.argumentDigest,
          outcome: { status: "fulfilled", value: "charged" }
        }),
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).rejects.toBeInstanceOf(HostCallResumabilityError);

    await expect(
      run(source, {
        hostCallResumeProvider: () => ({
          callId: call.id,
          sourceHash: call.sourceHash,
          moduleId: call.moduleId,
          operation: call.operation,
          argumentDigest: call.argumentDigest,
          outcome: { status: "fulfilled", value: "charged" }
        }),
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({ returnValue: "charged" });
    expect(invocations).toBe(1);

    deferred.resolve("charged");
    await first;
  });

  it("dispatches a non-idempotent call restored before first dispatch exactly once", async () => {
    const source = 'import { charge } from "payments"; return await charge("order-1");';
    let invocations = 0;
    const charge = declareHostOperation(async () => {
      invocations += 1;
      return "charged";
    }, "read-side-effect");
    const sourceHash = hashSource(source);
    const argumentDigest = digestHostCallArguments(["order-1"]);
    const snapshot = restore(
      {
        version: DUMP_FORMAT_VERSION,
        sourceHash,
        bindings: {},
        hostCalls: [
          {
            id: "run:1",
            runId: "run",
            sourceHash,
            moduleId: "payments",
            operation: "charge",
            argumentDigest,
            policy: "read-side-effect",
            lifecycle: "created"
          }
        ]
      },
      { source }
    );

    await expect(
      run(source, { modules: { payments: { charge } }, snapshot })
    ).resolves.toMatchObject({
      returnValue: "charged"
    });
    expect(invocations).toBe(1);
  });

  it("reconciles multiple pending non-idempotent calls in call order", async () => {
    const source = [
      'import { charge } from "payments";',
      'const left = charge("left");',
      'const right = charge("right");',
      "return JSON.stringify(await Promise.all([left, right]));"
    ].join("\n");
    const left = createDeferred<string>();
    const right = createDeferred<string>();
    let invocations = 0;
    const charge = declareHostOperation(async (id: string) => {
      invocations += 1;
      return id === "left" ? left.promise : right.promise;
    }, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    const seen: string[] = [];
    const values = new Map(
      snapshot.hostCalls.map((call: { id: string }, index: number) => [
        call.id,
        index === 0 ? "left" : "right"
      ])
    );

    await expect(
      run(source, {
        hostCallResumeProvider: (request) => {
          seen.push(request.callId);
          return {
            callId: request.callId,
            sourceHash: request.sourceHash,
            moduleId: request.moduleId,
            operation: request.operation,
            argumentDigest: request.argumentDigest,
            outcome: { status: "fulfilled", value: values.get(request.callId)! }
          };
        },
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({ returnValue: JSON.stringify(["left", "right"]) });
    expect(seen).toEqual(snapshot.hostCalls.map((call: { id: string }) => call.id));
    expect(invocations).toBe(2);

    left.resolve("left");
    right.resolve("right");
    await first;
  });

  it("delivers a reconciled rejection once to a sandbox catch", async () => {
    const source = [
      'import { charge } from "payments";',
      "try {",
      '  await charge("order-1");',
      '} catch (error) { return "caught:" + error.message; }'
    ].join("\n");
    const deferred = createDeferred<string>();
    const charge = declareHostOperation(async () => deferred.promise, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    let reconciliations = 0;

    await expect(
      run(source, {
        hostCallResumeProvider: (request) => {
          reconciliations += 1;
          return {
            callId: request.callId,
            sourceHash: request.sourceHash,
            moduleId: request.moduleId,
            operation: request.operation,
            argumentDigest: request.argumentDigest,
            outcome: {
              status: "rejected",
              reason: { name: "Error", message: "declined" }
            }
          };
        },
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({ returnValue: "caught:declined" });
    expect(reconciliations).toBe(1);

    deferred.resolve("unused");
    await first;
  });

  it("reports a reconciled unhandled rejection once", async () => {
    const source = 'import { charge } from "payments"; return charge("order-1");';
    const deferred = createDeferred<string>();
    const charge = declareHostOperation(async () => deferred.promise, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    let reconciliations = 0;

    await expect(
      run(source, {
        hostCallResumeProvider: (request) => {
          reconciliations += 1;
          return {
            callId: request.callId,
            sourceHash: request.sourceHash,
            moduleId: request.moduleId,
            operation: request.operation,
            argumentDigest: request.argumentDigest,
            outcome: {
              status: "rejected",
              reason: { name: "Error", message: "declined" }
            }
          };
        },
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).rejects.toMatchObject({ name: "UnhandledRejectionError" });
    expect(reconciliations).toBe(1);

    deferred.resolve("unused");
    await first;
  });

  it("rejects malformed restored host-call source identity before invocation", async () => {
    const source = 'import { charge } from "payments"; return await charge("order-1");';
    const deferred = createDeferred<string>();
    let invocations = 0;
    const charge = declareHostOperation(async () => {
      invocations += 1;
      return deferred.promise;
    }, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    snapshot.hostCalls[0].sourceHash = "stale";

    await expect(
      run(source, {
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).rejects.toThrow("sourceHash must match the snapshot");
    expect(invocations).toBe(1);

    deferred.resolve("charged");
    await first;
  });

  it.each([
    [
      "mixed run ids",
      (snapshot: any) => {
        snapshot.hostCalls[1].runId = "other-run";
      }
    ],
    [
      "duplicate call ids",
      (snapshot: any) => {
        snapshot.hostCalls[1].id = snapshot.hostCalls[0].id;
      }
    ],
    [
      "call ids outside the run",
      (snapshot: any) => {
        snapshot.hostCalls[1].id = `other-run:2`;
      }
    ]
  ])("rejects %s before external reconciliation", async (_name, corrupt) => {
    const source = [
      'import { charge } from "payments";',
      'const left = charge("left");',
      'const right = charge("right");',
      "return await Promise.all([left, right]);"
    ].join("\n");
    const left = createDeferred<string>();
    const right = createDeferred<string>();
    let invocations = 0;
    const charge = declareHostOperation(async (order: string) => {
      invocations += 1;
      return order === "left" ? left.promise : right.promise;
    }, "read-side-effect");
    const first = run(source, { modules: { payments: { charge } } });
    const snapshotPromise = dump(first);
    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    corrupt(snapshot);
    let reconciliations = 0;

    await expect(
      run(source, {
        hostCallResumeProvider: () => {
          reconciliations += 1;
          throw new Error("must not reconcile malformed journal");
        },
        modules: { payments: { charge } },
        snapshot: restore(snapshot, { source })
      })
    ).rejects.toThrow();
    expect(reconciliations).toBe(0);
    expect(invocations).toBe(2);

    left.resolve("left");
    right.resolve("right");
    await first;
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

function withoutCheckpointPosition<
  TSnapshot extends { pendingAwaits?: unknown; promiseReplay?: unknown }
>(snapshot: TSnapshot): Omit<TSnapshot, "pendingAwaits" | "promiseReplay"> {
  const {
    pendingAwaits: ignoredPendingAwaits,
    promiseReplay: ignoredPromiseReplay,
    ...rest
  } = snapshot;
  void ignoredPendingAwaits;
  void ignoredPromiseReplay;
  return rest;
}
