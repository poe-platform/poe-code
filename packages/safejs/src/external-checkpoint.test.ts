import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";

import { declareHostOperation, dump, restore, run, type HostCallResumeRequest } from "./index.js";
import { promiseReplayContext } from "./interp/promise-replay.js";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("external replay checkpoints", () => {
  it.each(["return await callback()", "return ("])(
    "disposes the run-local host context after executing %s",
    async (source) => {
      const disable = vi.spyOn(AsyncLocalStorage.prototype, "disable");
      try {
        await run(source, { bindings: { callback: async () => 1 } }).catch(() => undefined);
        expect(
          disable.mock.contexts.filter((context) => context !== promiseReplayContext)
        ).toHaveLength(1);
      } finally {
        disable.mockRestore();
      }
    }
  );

  it.each(["re-issue", "read-side-effect"] as const)(
    "restores a checkpoint requested while a %s host call is pending",
    async (policy) => {
      const source = `const first = await lookup(2);
const final = await checkpoint("hold");
return { first, final };`;
      const gate = deferred<number>();
      const paused = deferred<void>();
      let released = false;
      const execution = run(source, {
        bindings: {
          lookup: declareHostOperation(async (value: number) => value * 10, "re-issue"),
          checkpoint: declareHostOperation(async () => {
            paused.resolve();
            return gate.promise;
          }, policy)
        }
      });

      try {
        await paused.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(() => dump(execution)).toThrow(expect.objectContaining({ code: "reentry" }));
        expect(() => dump(execution, { mode: "capture" })).toThrow(
          expect.objectContaining({ code: "reentry" })
        );

        const saved = await dump(execution, { mode: "replay" });
        expect(released).toBe(false);
        const snapshot = restore(JSON.parse(saved), { source });
        expect(snapshot.executionSemantics).toBe("jobs-v7");
        expect(snapshot.hostCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ operation: "checkpoint", lifecycle: "running" })
          ])
        );

        released = true;
        gate.resolve(13);
        const original = await execution;

        const lookup = vi.fn(async (value: number) => value * 10);
        const checkpoint = vi.fn(async () => 13);
        const reconcile = vi.fn(async (request: HostCallResumeRequest) => {
          const completedCall = original.snapshot.hostCalls?.find(
            (call) => call.id === request.callId
          );
          if (completedCall?.outcome === undefined) throw new Error("Missing observed outcome");
          return {
            callId: request.callId,
            sourceHash: request.sourceHash,
            moduleId: request.moduleId,
            operation: request.operation,
            argumentDigest: request.argumentDigest,
            outcome: completedCall.outcome
          };
        });
        const resumed = await run(source, {
          snapshot,
          bindings: {
            lookup: declareHostOperation(lookup, "re-issue"),
            checkpoint: declareHostOperation(checkpoint, policy)
          },
          hostCallResumeProvider: policy === "read-side-effect" ? reconcile : undefined
        });
        expect(resumed).toMatchObject({ ok: true, returnValue: { first: 20, final: 13 } });
        expect(lookup).not.toHaveBeenCalled();
        expect(checkpoint).toHaveBeenCalledTimes(policy === "re-issue" ? 1 : 0);
        expect(reconcile).toHaveBeenCalledTimes(policy === "read-side-effect" ? 1 : 0);

        const completed = await dump(resumed);
        checkpoint.mockClear();
        const replayed = await run(source, {
          snapshot: restore(JSON.parse(completed), { source }),
          bindings: {
            lookup: declareHostOperation(lookup, "re-issue"),
            checkpoint: declareHostOperation(checkpoint, policy)
          }
        });
        expect(replayed).toMatchObject({ ok: true, returnValue: { first: 20, final: 13 } });
        expect(lookup).not.toHaveBeenCalled();
        expect(checkpoint).not.toHaveBeenCalled();
      } finally {
        released = true;
        gate.resolve(13);
        await expect(execution).resolves.toMatchObject({
          ok: true,
          returnValue: { first: 20, final: 13 }
        });
      }
    }
  );

  it("rejects replay dumping from an asynchronous callback of the same run", async () => {
    const execution = run("return await callback()", {
      bindings: {
        async callback() {
          await Promise.resolve();
          expect(() => dump(execution, { mode: "replay" })).toThrow(
            expect.objectContaining({ code: "reentry" })
          );
          return 1;
        }
      }
    });

    await expect(execution).resolves.toMatchObject({ ok: true, returnValue: 1 });
  });

  it("waits for the first yield when replay is requested before host work starts", async () => {
    const gate = deferred<number>();
    const execution = run("return await checkpoint()", {
      bindings: {
        checkpoint: declareHostOperation(() => gate.promise, "re-issue")
      }
    });

    try {
      const saved = await dump(execution, { mode: "replay" });
      expect(restore(JSON.parse(saved), { source: "return await checkpoint()" }).hostCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ lifecycle: "running" })])
      );
    } finally {
      gate.resolve(13);
      await expect(execution).resolves.toMatchObject({ ok: true, returnValue: 13 });
    }
  });
});
