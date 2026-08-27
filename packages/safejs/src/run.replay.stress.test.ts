import { afterEach, describe, expect, it, vi } from "vitest";

import { restore, type SafeJSSnapshot } from "./restore.js";
import { run, type RunOptions, type RunResult } from "./run.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";
import { createSeededRandom } from "./interp/globals/math.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { createSandboxClosure, createSandboxPromise } from "./interp/values.js";

async function captureRun(
  source: string,
  stopAt: number | string,
  snapshot?: SafeJSSnapshot,
  bindings: RunOptions["bindings"] = {},
  options: Pick<RunOptions, "sink" | "modules" | "entryPointArgs" | "importMeta" | "signal"> = {}
) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let release!: () => void;
  let checkpointWritten!: (value: SafeJSSnapshot) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const checkpoint = new Promise<SafeJSSnapshot>((resolve) => {
    checkpointWritten = resolve;
  });
  let calls = 0;
  const execution = run(source, {
    ...options,
    snapshot,
    snapshotIntervalMs: 1,
    snapshotBackend: {
      async read() {
        return undefined;
      },
      async remove() {},
      async write(value) {
        checkpointWritten(JSON.parse(serializeSafeJSSnapshot(value)));
      }
    },
    bindings: {
      ...bindings,
      async wait(value: unknown) {
        calls += 1;
        if ((typeof stopAt === "number" && calls === stopAt) || value === stopAt) {
          clock.mockReturnValue(2);
          await gate;
        }
        return value;
      }
    }
  });
  const saved = await Promise.race([
    checkpoint,
    execution.then((result) => {
      throw new Error(`Execution finished before checkpoint: ${JSON.stringify(result)}`);
    })
  ]);
  release();
  const finished = await execution;
  clock.mockRestore();
  expect(finished.ok).toBe(true);
  return { saved, finished };
}

async function finishReplay(execution: Promise<RunResult>): Promise<RunResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Callback replay stalled")), 100);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

describe("checkpoint interaction stress", () => {
  it.each(["throw", "promise"] as const)(
    "rejects a replay state hook that returns %s without stalling",
    async (behavior) => {
      const read = declareHostOperation(async () => 1, "re-issue", {
        onReplay: () => {
          if (behavior === "promise") return Promise.resolve();
          throw new Error("invalid local state");
        }
      });
      const source =
        "try { await read(); } catch (error) { return 'caught'; } await wait('after'); return 'done';";
      const original = await captureRun(source, "after", undefined, { read });
      await expect(
        finishReplay(
          run(source, {
            snapshot: original.saved,
            bindings: { read, wait: async () => undefined }
          })
        )
      ).rejects.toMatchObject({ name: "HostCallResumabilityError", action: "reset" });
    }
  );

  it.each(["fulfilled", "rejected"] as const)(
    "notifies local state hooks only for replayed %s outcomes",
    async (status) => {
      const onReplay = vi.fn();
      const operation = vi.fn(async (value: number) => {
        if (status === "rejected") throw new Error(`failure:${value}`);
        return value * 2;
      });
      const read = declareHostOperation(operation, "re-issue", { onReplay });
      const source =
        "let value; try { value = await read(4); } catch (error) { value = error.message; } await wait('after'); return value;";
      const original = await captureRun(source, "after", undefined, { read });
      expect(onReplay).not.toHaveBeenCalled();
      const resumed = await finishReplay(
        run(source, {
          snapshot: original.saved,
          bindings: { read, wait: async () => undefined }
        })
      );
      expect(resumed).toMatchObject({
        ok: true,
        returnValue: status === "fulfilled" ? 8 : "failure:4"
      });
      expect(operation).toHaveBeenCalledOnce();
      expect(onReplay).toHaveBeenCalledExactlyOnceWith(
        [4],
        status === "fulfilled"
          ? { status, value: 8 }
          : { status, reason: expect.objectContaining({ message: "failure:4" }) }
      );
    }
  );

  it("preserves replay history before cancellation unwinds the run", async () => {
    const source = "const value = Math.random(); await wait(); return [value, Math.random()];";
    const controller = new AbortController();
    let saved: SafeJSSnapshot | undefined;
    let written!: () => void;
    const checkpoint = new Promise<void>((resolve) => {
      written = resolve;
    });
    const execution = run(source, {
      randomSeed: 123,
      signal: controller.signal,
      bindings: { wait: async () => await new Promise(() => undefined) },
      snapshotIntervalMs: -1,
      snapshotBackend: {
        async read() {
          return saved;
        },
        async remove() {},
        async write(value) {
          saved = JSON.parse(serializeSafeJSSnapshot(value));
          written();
        }
      }
    });
    await checkpoint;
    const durable = structuredClone(saved);
    controller.abort();
    await expect(finishReplay(execution)).rejects.toMatchObject({ name: "AbortError" });
    expect(saved).toMatchObject({
      replay: durable!.replay,
      initialInputs: durable!.initialInputs,
      promiseReplay: durable!.promiseReplay,
      random: { seed: 123, state: durable!.random!.state }
    });
    const random = createSeededRandom(123);
    const resumed = await finishReplay(
      run(source, { snapshot: saved, bindings: { wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: [random.next(), random.next()] });
  });
  it.each(
    [false, true].flatMap((originalSignal) =>
      [false, true].map((resumedSignal) => ({ originalSignal, resumedSignal }))
    )
  )(
    "replays with changed signal presence ($originalSignal -> $resumedSignal)",
    async ({ originalSignal, resumedSignal }) => {
      const source =
        "const value = Math.random(); await wait('after'); return [value, Math.random()];";
      const first = await captureRun(
        source,
        "after",
        undefined,
        {},
        { signal: originalSignal ? new AbortController().signal : undefined }
      );
      const resumed = await finishReplay(
        run(source, {
          snapshot: first.saved,
          bindings: { wait: async () => undefined },
          signal: resumedSignal ? new AbortController().signal : undefined
        })
      );
      expect(resumed).toMatchObject({
        ok: true,
        returnValue: first.finished.ok ? first.finished.returnValue : undefined
      });
    }
  );
  it("does not repeat completed nested host methods", async () => {
    let invocations = 0;
    const service = { read: async () => ++invocations };
    const source = "const value = await service.read(); await wait('after'); return value;";
    const first = await captureRun(source, "after", undefined, { service });
    const resumed = await finishReplay(
      run(source, { snapshot: first.saved, bindings: { service, wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 1 });
    expect(invocations).toBe(1);
  });
  it("restores a completed injected promise without requiring its original native object", async () => {
    const source = "const value = await pending; await wait('after'); return value;";
    const first = await captureRun(source, "after", undefined, {
      pending: createSandboxPromise(Promise.resolve(42))
    });
    const resumed = await finishReplay(
      run(source, { snapshot: first.saved, bindings: { wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 42 });
  });
  it("requires external reconciliation for a pending injected promise", async () => {
    let release!: (value: number) => void;
    const pending = createSandboxPromise(
      new Promise<number>((resolve) => {
        release = resolve;
      })
    );
    const source = "await wait('after'); finish(); return await pending;";
    const finish = () => release(42);
    const first = await captureRun(source, "after", undefined, { pending, finish });
    const reconcile = vi.fn((request) => ({
      ...request,
      outcome: { status: "fulfilled" as const, value: 42 }
    }));
    const resumed = await finishReplay(
      run(source, {
        snapshot: first.saved,
        bindings: { finish, wait: async () => undefined },
        hostCallResumeProvider: reconcile
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 42 });
    expect(reconcile).toHaveBeenCalledTimes(1);
    const malformed = structuredClone(first.saved);
    const nodes = (malformed.initialInputs as any).nodes;
    nodes[0].properties.entryPointArgs.value = 42;
    reconcile.mockClear();
    await expect(
      run(source, {
        snapshot: malformed,
        bindings: { finish, wait: async () => undefined },
        hostCallResumeProvider: reconcile
      })
    ).rejects.toThrow(/arguments/i);
    expect(reconcile).not.toHaveBeenCalled();
  });
  afterEach(() => vi.restoreAllMocks());

  it("preserves original bindings, imports, entry arguments and import metadata", async () => {
    const source =
      "import { settings } from 'input'; export default async function (input) { const values = [payload.value, settings.value, input.value, import.meta.value]; await wait('after'); return values; }";
    const first = await captureRun(
      source,
      "after",
      undefined,
      { payload: { value: 0 } },
      {
        modules: { input: { settings: { value: 1 } } },
        entryPointArgs: [{ value: 2 }],
        importMeta: { value: 3 }
      }
    );
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { payload: { value: 9 }, wait: async () => undefined },
        modules: { input: { settings: { value: 9 } } },
        entryPointArgs: [{ value: 9 }],
        importMeta: { value: 9 }
      })
    );
    expect(first.finished).toMatchObject({ ok: true, returnValue: [0, 1, 2, 3] });
    expect(resumed).toMatchObject({ ok: true, returnValue: [0, 1, 2, 3] });
  });

  it("captures initial input data before mutations and preserves its aliases and cycles", async () => {
    const source =
      "const initial = payload.value; payload.value += 1; await wait('after'); return [initial, payload.value, payload === alias, payload.self === payload];";
    const payload: Record<string, unknown> = { value: 4 };
    payload.self = payload;
    const first = await captureRun(source, "after", undefined, { payload, alias: payload });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { wait: async () => undefined }
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: [4, 5, true, true] });
  });

  it("restores data-only imports without requiring the caller to retain the original module", async () => {
    const source =
      "import { settings } from 'input'; const value = settings.value; await wait(); return value;";
    const first = await captureRun(
      source,
      1,
      undefined,
      {},
      { modules: { input: { settings: { value: 7 } } } }
    );
    const resumed = await finishReplay(
      run(source, {
        snapshot: first.saved,
        bindings: { wait: async () => undefined }
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 7 });
  });

  it.each(["re-issue", "read-side-effect"] as const)(
    "checkpoints a source function passed through a %s native identity operation",
    async (policy) => {
      const source =
        "const callback = await echo(() => 42); await wait('after'); return callback();";
      let invocations = 0;
      const echo = declareHostOperation(async (value: unknown) => {
        invocations += 1;
        return value;
      }, policy);
      const first = await captureRun(source, "after", undefined, { echo });
      const resumed = await finishReplay(
        run(source, {
          snapshot: restore(first.saved, { source }),
          bindings: { echo, wait: async () => undefined }
        })
      );
      expect(resumed).toMatchObject({ ok: true, returnValue: 42 });
      expect(invocations).toBe(1);
    }
  );

  it.each([false, true])(
    "preserves returned source identity and lexical mutations (async: %s)",
    async (asynchronous) => {
      const source =
        "let count = 0; const original = () => ++count; const callback = await echo(original); callback(); await wait('after'); return [callback === original, callback(), original()];";
      let invocations = 0;
      const operation = (value: unknown) => {
        invocations += 1;
        return value;
      };
      const echo = asynchronous ? async (value: unknown) => operation(value) : operation;
      const first = await captureRun(source, "after", undefined, { echo });
      const resumed = await finishReplay(
        run(source, { snapshot: first.saved, bindings: { echo, wait: async () => undefined } })
      );
      expect(first.finished).toMatchObject({ ok: true, returnValue: [true, 2, 3] });
      expect(resumed).toMatchObject({ ok: true, returnValue: [true, 2, 3] });
      expect(invocations).toBe(1);
    }
  );

  it("restores a source function created by a replayed asynchronous callback", async () => {
    const source =
      "let count = 0; const callback = await apply(async () => { await Promise.resolve(); return () => ++count; }); callback(); await wait('after'); return callback();";
    let invocations = 0;
    const apply = async (callback: () => Promise<unknown>) => {
      invocations += 1;
      return await callback();
    };
    const first = await captureRun(source, "after", undefined, { apply });
    const resumed = await finishReplay(
      run(source, { snapshot: first.saved, bindings: { apply, wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 2 });
    expect(invocations).toBe(1);
  });

  it("delivers a returned function before its detached producer callback completes", async () => {
    let publish!: (value: unknown) => void;
    const published = new Promise<unknown>((resolve) => {
      publish = resolve;
    });
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let callbackResult: Promise<unknown> | undefined;
    const launch = async (callback: () => Promise<unknown>) => {
      callbackResult = callback();
      return await published;
    };
    const bindings = {
      launch,
      publish: async (value: unknown) => publish(value),
      block: () => blocked,
      finish: async () => {
        unblock();
        await callbackResult;
      }
    };
    const source =
      "let count = 0; const callback = await launch(async () => { await publish(() => ++count); await block(); }); await wait('after'); await finish(); return callback();";
    const first = await captureRun(source, "after", undefined, bindings);
    const resumed = await finishReplay(
      run(source, { snapshot: first.saved, bindings: { ...bindings, wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 1 });
  });

  it("preserves source function identity inside replayed callback arguments", async () => {
    const source =
      "const original = () => 42; let result; await bounce(original, callback => { result = [callback === original, callback()]; }); await wait('after'); return result;";
    let invocations = 0;
    const bounce = async (value: unknown, callback: (value: unknown) => Promise<unknown>) => {
      invocations += 1;
      return await callback(value);
    };
    const first = await captureRun(source, "after", undefined, { bounce });
    const resumed = await finishReplay(
      run(source, { snapshot: first.saved, bindings: { bounce, wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: [true, 42] });
    expect(invocations).toBe(1);
  });

  it("preserves source functions through repeated checkpoint chains", async () => {
    const source =
      "let count = 0; const callback = await echo(() => ++count); callback(); await wait('first'); callback(); await wait('second'); return callback();";
    let invocations = 0;
    const echo = async (value: unknown) => {
      invocations += 1;
      return value;
    };
    const first = await captureRun(source, "first", undefined, { echo });
    const second = await captureRun(source, "second", first.saved, { echo });
    const resumed = await finishReplay(
      run(source, { snapshot: second.saved, bindings: { echo, wait: async () => undefined } })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: 3 });
    expect(invocations).toBe(1);
  });

  it("restores initial data attached to rebound sandbox capabilities", async () => {
    const source =
      "const initial = operation.settings.value; operation.settings.value += 1; await wait(); return [initial, operation.settings.value, operation()];";
    const operation = createSandboxClosure({
      call: () => 42,
      properties: { settings: { value: 5 } }
    });
    const first = await captureRun(source, 1, undefined, { operation });
    const resumed = await finishReplay(
      run(source, {
        snapshot: first.saved,
        bindings: {
          operation: createSandboxClosure({
            call: () => 42,
            properties: { settings: { value: 99 } }
          }),
          wait: async () => undefined
        }
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: [5, 6, 42] });
  });

  it("rebuilds mutations performed by a completed host callback without repeating the host effect", async () => {
    const source =
      "const values = []; await apply(value => values.push(value)); await wait('after'); return values;";
    let invocations = 0;
    const apply = async (callback: (value: string) => Promise<unknown>) => {
      invocations += 1;
      return await callback("called");
    };
    const first = await captureRun(source, "after", undefined, { apply });
    expect(first.finished).toMatchObject({ ok: true, returnValue: ["called"] });
    const resumed = run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { apply, wait: async () => undefined }
    });
    expect(await finishReplay(resumed)).toMatchObject({ ok: true, returnValue: ["called"] });
    expect(invocations).toBe(1);
  });

  describe.each([false, true])("host callback scheduling (deferred: %s)", (deferred) => {
    it.each([1, 4, 16])("replays %i sequential async callback invocations", async (width) => {
      const source =
        "const values = []; await apply(async value => { values.push([value, Math.random()]); await Promise.resolve(); return value * 2; }); await wait('after'); return values;";
      let invocations = 0;
      const apply = async (callback: (value: number) => Promise<number>) => {
        invocations += 1;
        const returned = [];
        for (let index = 0; index < width; index += 1) {
          if (deferred) await new Promise<void>((resolve) => setImmediate(resolve));
          returned.push(await callback(index));
        }
        return returned;
      };
      const first = await captureRun(source, "after", undefined, { apply });
      const random = createSeededRandom(first.saved.random!.seed);
      const expected = Array.from({ length: width }, (_, index) => [index, random.next()]);
      expect(first.finished).toMatchObject({ ok: true, returnValue: expected });
      const resumed = await finishReplay(
        run(source, {
          snapshot: restore(first.saved, { source }),
          bindings: { apply, wait: async () => undefined }
        })
      );
      expect(resumed).toMatchObject({ ok: true, returnValue: expected });
      expect(invocations).toBe(1);
    });
  });

  it("replays a callback returned from another callback", async () => {
    const source =
      "const values = []; await apply(value => { values.push(value); return next => values.push(next); }); await wait('after'); return values;";
    let invocations = 0;
    const apply = async (
      callback: (value: string) => Promise<(value: string) => Promise<unknown>>
    ) => {
      invocations += 1;
      const next = await callback("outer");
      return await next("inner");
    };
    const first = await captureRun(source, "after", undefined, { apply });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { apply, wait: async () => undefined }
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: ["outer", "inner"] });
    expect(invocations).toBe(1);
  });

  it("preserves aliased cyclic callback arguments before script mutations", async () => {
    const source =
      "const values = []; await apply((left, right) => { values.push(left === right, left.self === left); left.nested.value += 1; values.push(left.nested.value); }); await wait('after'); return values;";
    const apply = async (callback: (...args: unknown[]) => Promise<unknown>) => {
      const value: Record<string, unknown> = { nested: { value: 2 } };
      value.self = value;
      await callback(value, value);
    };
    const first = await captureRun(source, "after", undefined, { apply });
    expect(first.finished).toMatchObject({ ok: true, returnValue: [true, true, 3] });
    expect(
      await finishReplay(
        run(source, {
          snapshot: restore(first.saved, { source }),
          bindings: { apply, wait: async () => undefined }
        })
      )
    ).toMatchObject({ ok: true, returnValue: [true, true, 3] });
  });

  it("replays callback rejection handled by the native host", async () => {
    const source =
      "const values = []; const message = await apply(() => { values.push(Math.random()); throw Error('expected'); }); await wait('after'); return [values, message];";
    let invocations = 0;
    const apply = async (callback: () => Promise<unknown>) => {
      invocations += 1;
      try {
        await callback();
      } catch (error) {
        return (error as Error).message;
      }
      return "not thrown";
    };
    const first = await captureRun(source, "after", undefined, { apply });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { apply, wait: async () => undefined }
      })
    );
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: first.finished.ok ? first.finished.returnValue : undefined
    });
    expect(invocations).toBe(1);
  });

  it("replays nested host calls made inside a callback without repeating either effect", async () => {
    const source =
      "const values = []; await apply(async index => { values.push(await effect(index), Math.random()); }); await wait('after'); return values;";
    let outerCalls = 0;
    let innerCalls = 0;
    const apply = async (callback: (index: number) => Promise<unknown>) => {
      outerCalls += 1;
      for (let index = 0; index < 8; index += 1) await callback(index);
    };
    const effect = async (index: number) => {
      innerCalls += 1;
      return index * 2;
    };
    const first = await captureRun(source, "after", undefined, { apply, effect });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { apply, effect, wait: async () => undefined }
      })
    );
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: first.finished.ok ? first.finished.returnValue : undefined
    });
    expect(outerCalls).toBe(1);
    expect(innerCalls).toBe(8);
  });

  it("preserves callback state across two successive checkpoint restores", async () => {
    const source =
      "const values = []; await apply(value => values.push(value, Math.random())); await wait('first'); await apply(value => values.push(value, Math.random())); await wait('second'); return values;";
    let invocations = 0;
    const apply = async (callback: (value: string) => Promise<unknown>) => {
      invocations += 1;
      await callback("called");
    };
    const first = await captureRun(source, "first", undefined, { apply });
    const second = await captureRun(source, "second", restore(first.saved, { source }), { apply });
    const third = await finishReplay(
      run(source, {
        snapshot: restore(second.saved, { source }),
        bindings: { apply, wait: async () => undefined }
      })
    );
    const expected = {
      ok: true,
      returnValue: first.finished.ok ? first.finished.returnValue : undefined
    };
    expect(second.finished).toMatchObject(expected);
    expect(third).toMatchObject(expected);
    expect(invocations).toBe(3);
  });

  it("resumes an in-flight re-issuable host operation from inside its callback", async () => {
    const source =
      "const values = []; await apply(async value => { values.push(value, Math.random()); await wait('inside'); values.push(Math.random()); }); return values;";
    let invocations = 0;
    const apply = async (callback: (value: string) => Promise<unknown>) => {
      invocations += 1;
      return await callback("called");
    };
    const first = await captureRun(source, "inside", undefined, { apply });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { apply, wait: async () => undefined }
      })
    );
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: first.finished.ok ? first.finished.returnValue : undefined
    });
    expect(invocations).toBe(2);
  });

  it.each([0, 3, 7])(
    "replays a re-issued callback loop paused at invocation %i",
    async (stopAt) => {
      const source = `const values = []; await apply(async value => { values.push(value, Math.random()); if (value === ${stopAt}) await wait('inside'); values.push(Math.random()); }); return values;`;
      let invocations = 0;
      const apply = async (callback: (value: number) => Promise<unknown>) => {
        invocations += 1;
        for (let index = 0; index < 8; index += 1) await callback(index);
      };
      const first = await captureRun(source, "inside", undefined, { apply });
      const resumed = await finishReplay(
        run(source, {
          snapshot: restore(first.saved, { source }),
          bindings: { apply, wait: async () => undefined }
        })
      );
      expect(resumed).toMatchObject({
        ok: true,
        returnValue: first.finished.ok ? first.finished.returnValue : undefined
      });
      expect(invocations).toBe(2);
    }
  );

  it.each([false, true])(
    "requires an explicit callback completion proof for a non-idempotent host call (provided: %s)",
    async (provided) => {
      const source =
        "let count = 0; await apply(async () => { count += 1; await wait('inside'); for (let index = 0; index < 10; index += 1) { await Promise.resolve(); count += 1; } }); return count;";
      let invocations = 0;
      const apply = declareHostOperation(async (callback: () => Promise<unknown>) => {
        invocations += 1;
        await callback();
      }, "read-side-effect");
      const first = await captureRun(source, "inside", undefined, { apply });
      expect(first.finished).toMatchObject({ ok: true, returnValue: 11 });
      const resumed = finishReplay(
        run(source, {
          snapshot: restore(first.saved, { source }),
          bindings: { apply, wait: async () => undefined },
          hostCallResumeProvider: (request) => ({
            ...request,
            ...(provided ? { callbackDisposition: "joined" as const } : {}),
            outcome: { status: "fulfilled", value: undefined }
          })
        })
      );
      if (provided) await expect(resumed).resolves.toMatchObject({ ok: true, returnValue: 11 });
      else await expect(resumed).rejects.toThrow(/callbackDisposition/);
      expect(invocations).toBe(1);
    }
  );

  it("lets an external resumer invoke a callback that had not started before the checkpoint", async () => {
    const source =
      "const values = []; const pending = apply(value => { values.push(read(), value); }); await wait('before'); await pending; return values;";
    let invocations = 0;
    let reads = 0;
    const apply = declareHostOperation(async (callback: (value: string) => Promise<unknown>) => {
      invocations += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      await callback("late");
    }, "read-side-effect");
    const read = () => {
      reads += 1;
      return "read";
    };
    const first = await captureRun(source, "before", undefined, { apply, read });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { apply, read, wait: async () => undefined },
        hostCallResumeProvider: async (request, context) => {
          await context!.callbacks.get(1)!("late");
          return {
            ...request,
            callbackDisposition: "joined",
            outcome: { status: "fulfilled", value: undefined }
          };
        }
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: ["read", "late"] });
    expect(invocations).toBe(1);
    expect(reads).toBe(2);
  });

  it("lets an external resumer continue after a previously started callback", async () => {
    const source =
      "const values = []; await apply(async value => { values.push(value); await wait('inside'); }); return values;";
    let invocations = 0;
    const apply = declareHostOperation(async (callback: (value: string) => Promise<unknown>) => {
      invocations += 1;
      await callback("first");
      await callback("second");
    }, "read-side-effect");
    const first = await captureRun(source, "inside", undefined, { apply });
    const resumed = await finishReplay(
      run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { apply, wait: async () => undefined },
        hostCallResumeProvider: async (request, context) => {
          await context!.replayed[0]!.result;
          await context!.callbacks.get(1)!("second");
          return {
            ...request,
            callbackDisposition: "joined",
            outcome: { status: "fulfilled", value: undefined }
          };
        }
      })
    );
    expect(resumed).toMatchObject({ ok: true, returnValue: ["first", "second"] });
    expect(invocations).toBe(1);
  });

  it.each(["missing trace", "unknown token"])(
    "rejects callback metadata with %s before host effects",
    async (corruption) => {
      const source = "await apply(value => value); await wait('after'); return 1;";
      let invocations = 0;
      const apply = async (callback: (value: number) => Promise<unknown>) => {
        invocations += 1;
        return await callback(1);
      };
      const first = await captureRun(source, "after", undefined, { apply });
      const snapshot = first.saved as any;
      if (corruption === "missing trace") delete snapshot.promiseReplay.events;
      else {
        const token = snapshot.promiseReplay.events.find(
          (entry: any) => entry.kind === "callback-start"
        ).token;
        for (const event of snapshot.promiseReplay.events)
          if (event.token === token) event.token = "unknown";
      }
      await expect(
        finishReplay(
          run(source, {
            snapshot: restore(snapshot, { source }),
            bindings: { apply, wait: async () => undefined }
          })
        )
      ).rejects.toThrow(/callback.*(trace|journal|token)/i);
      expect(invocations).toBe(1);
    }
  );

  describe.each([
    {
      name: "random state captured by a factory closure",
      source:
        "const make = () => { const value = Math.random(); return () => value; }; const read = make(); const values = []; for (const index of [0, 1, 2]) { await wait(index); values.push(read(), Math.random()); } return values;"
    },
    {
      name: "mutation inside a random await argument",
      source:
        "const values = []; let count = 0; for (const index of [0, 1, 2]) { await wait(++count + Math.random()); values.push(count, Math.random()); } return values;"
    }
  ])("$name", ({ source }) => {
    it.each([1, 2])("matches uninterrupted execution after wait %i", async (stopAt) => {
      const { saved, finished } = await captureRun(source, stopAt);
      const resumed = await run(source, {
        snapshot: restore(saved, { source }),
        bindings: {
          async wait(value: unknown) {
            return value;
          }
        }
      });
      expect(resumed).toMatchObject({
        ok: true,
        returnValue: finished.ok ? finished.returnValue : undefined
      });
    });
  });

  it("preserves the sequence across a loop checkpoint followed by a top-level checkpoint", async () => {
    const source =
      "const values = []; for (const index of [0, 1]) { values.push(Math.random()); await wait(index); } values.push(Math.random()); await wait('after'); return values.concat(Math.random());";
    const first = await captureRun(source, 1);
    const second = await captureRun(source, "after", restore(first.saved, { source }));
    const third = await run(source, {
      snapshot: restore(second.saved, { source }),
      bindings: {
        async wait(value: unknown) {
          return value;
        }
      }
    });
    expect(second.finished).toMatchObject({
      ok: true,
      returnValue: first.finished.ok ? first.finished.returnValue : undefined
    });
    expect(third).toMatchObject({
      ok: true,
      returnValue: first.finished.ok ? first.finished.returnValue : undefined
    });
  });

  it.each([false, true])(
    "does not repeat completed host effects (async: %s)",
    async (asynchronous) => {
      const source =
        "const values = []; for (const index of [0, 1, 2]) { const value = await read(index); values.push(value.count); value.count += 100; } await wait('after'); return values;";
      const effect = vi.fn((index: number) => ({ count: index + 1 }));
      const bindings = { read: asynchronous ? async (index: number) => effect(index) : effect };
      const first = await captureRun(source, "after", undefined, bindings);
      expect(effect).toHaveBeenCalledTimes(3);
      const resumed = await run(source, {
        snapshot: restore(first.saved, { source }),
        bindings: { ...bindings, wait: async () => undefined }
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: [1, 2, 3] });
      expect(effect).toHaveBeenCalledTimes(3);
    }
  );

  it("replays synchronous host failures without turning them into promises", async () => {
    const source =
      "let message; try { fail(); } catch (error) { message = error.message; } await wait('after'); return message;";
    const fail = vi.fn(() => {
      throw new Error("expected failure");
    });
    const first = await captureRun(source, "after", undefined, { fail });
    const resumed = await run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { fail, wait: async () => undefined }
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: "expected failure" });
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("does not repeat console output from before the checkpoint", async () => {
    const source = "console.log('before'); await wait('after'); console.error('after'); return 1;";
    const sink = { log: vi.fn(), error: vi.fn() };
    const first = await captureRun(source, "after", undefined, {}, { sink });
    const resumed = await run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { wait: async () => undefined },
      sink
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: 1 });
    expect(sink.log).toHaveBeenCalledExactlyOnceWith("before");
    expect(sink.error.mock.calls).toEqual([["after"], ["after"]]);
  });

  it("replays a caught console sink failure without invoking the sink again", async () => {
    const source =
      "let message; try { console.log('before'); } catch (error) { message = error.message; } await wait('after'); return message;";
    const sink = {
      log: vi.fn(() => {
        throw new Error("sink failed");
      }),
      error: vi.fn()
    };
    const first = await captureRun(source, "after", undefined, {}, { sink });
    const resumed = await run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { wait: async () => undefined },
      sink
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: "sink failed" });
    expect(sink.log).toHaveBeenCalledTimes(1);
  });

  it("preserves a race winner when host promises settle out of invocation order", async () => {
    const source =
      "let winner; { const pending = [slow(), fast()]; winner = await Promise.race(pending); await Promise.all(pending); } await wait('after'); return winner;";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = vi.fn(async () => {
      await gate;
      return "slow";
    });
    const fast = vi.fn(async () => {
      setImmediate(release);
      return "fast";
    });
    const bindings = {
      slow: async () => slow(),
      fast: async () => fast()
    };
    const first = await captureRun(source, "after", undefined, bindings);
    expect(first.finished).toMatchObject({ ok: true, returnValue: "fast" });
    const resumed = await run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { ...bindings, wait: async () => undefined }
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: "fast" });
    expect(slow).toHaveBeenCalledTimes(1);
    expect(fast).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["host race", "result = await Promise.race([slow(), fast()]);"],
    ["pure promise race", "result = await Promise.race([slow(), Promise.resolve('pure')]);"],
    ["first fulfillment", "result = await Promise.any([slow(), fast()]);"],
    ["settled aggregation", "result = await Promise.allSettled([slow(), fast()]);"],
    [
      "random draws in reactions",
      "result = []; await Promise.all([slow().then(value => result.push([value, Math.random()])), fast().then(value => result.push([value, Math.random()]))]);"
    ]
  ])("matches native JavaScript and replay for %s", async (_name, body) => {
    const source = `let result; { ${body} } await wait('after'); return result;`;
    const slow = async () => new Promise<string>((resolve) => setImmediate(() => resolve("slow")));
    const fast = async () => "fast";
    const first = await captureRun(source, "after", undefined, { slow, fast });
    const nativeMath = Object.create(Math);
    nativeMath.random = createSeededRandom(first.saved.random!.seed).next;
    const NativeAsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    const expected = await new NativeAsyncFunction("slow", "fast", "wait", "Math", source)(
      slow,
      fast,
      async () => undefined,
      nativeMath
    );
    expect(first.finished).toMatchObject({ ok: true, returnValue: expected });
    const resumed = await run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { slow, fast, wait: async () => undefined }
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([1, 8, 32])("matches native random reaction ordering across %i rounds", async (width) => {
    const source = `const rounds = []; for (let round = 0; round < ${width}; round += 1) { const values = []; await Promise.all([slow(round).then(value => values.push([value, Math.random()])), fast(round).then(value => values.push([value, Math.random()]))]); rounds.push(values); } await wait('after'); return rounds;`;
    const slow = async (round: number) =>
      new Promise<string>((resolve) => setImmediate(() => resolve(`slow-${round}`)));
    const fast = async (round: number) => `fast-${round}`;
    const first = await captureRun(source, "after", undefined, { slow, fast });
    const nativeMath = Object.create(Math);
    nativeMath.random = createSeededRandom(first.saved.random!.seed).next;
    const NativeAsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    const expected = await new NativeAsyncFunction("slow", "fast", "wait", "Math", source)(
      slow,
      fast,
      async () => undefined,
      nativeMath
    );
    expect(first.finished).toMatchObject({ ok: true, returnValue: expected });
    const resumed = await run(source, {
      snapshot: restore(first.saved, { source }),
      bindings: { slow, fast, wait: async () => undefined }
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: expected });
  });
});
