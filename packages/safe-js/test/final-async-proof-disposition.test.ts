import { expect, it } from "vitest";
import {
  declareHostOperation,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  dump,
  restore,
  run,
  type HostCallResumeProof
} from "@poe-code/safe-js";
import { bounded, deferred } from "./fixtures/final-async-proof.js";
import { callbackDispositionControls } from "./fixtures/final-async-proof-cases.js";

it.each(callbackDispositionControls)(
  "retains actual $callbackDisposition disposition",
  async (control) => {
    function hosts() {
      const callbackGate = deferred<void>();
      const callbackEntered = deferred<void>();
      const hostResultGate = deferred<void>();
      const finishGate = deferred<void>();
      const finishEntered = deferred<void>();
      let finishReached = false;
      const bindings = {
        start: declareHostOperation(async (callback: () => Promise<unknown>) => {
          const result = callback();
          await hostResultGate.promise;
          if (control.callbackDisposition === "joined") await result;
          return { value: 7 };
        }, "read-side-effect"),
        callbackGate: declareHostOperation(() => {
          callbackEntered.release();
          return callbackGate.promise;
        }, "re-issue"),
        finishGate: declareHostOperation(() => {
          finishReached = true;
          finishEntered.release();
          return finishGate.promise;
        }, "re-issue")
      };
      return {
        bindings,
        callbackGate,
        callbackEntered,
        hostResultGate,
        finishGate,
        finishEntered,
        finishReached: () => finishReached
      };
    }
    async function completeOriginal(host: ReturnType<typeof hosts>) {
      host.hostResultGate.release();
      if (control.callbackDisposition === "detached")
        await bounded(host.finishEntered.promise, "native detached source progress");
      host.callbackGate.release();
      await bounded(host.finishEntered.promise, "original finish");
      host.finishGate.release();
    }
    const nativeHost = hosts();
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    const native = new AsyncFunction(...Object.keys(nativeHost.bindings), control.source)(
      ...Object.values(nativeHost.bindings)
    );
    await bounded(nativeHost.callbackEntered.promise, "native callback");
    await completeOriginal(nativeHost);
    expect(await bounded(native, "native completion")).toEqual(control.expected);
    const originalHost = hosts();
    const originalExecution = run(control.source, { bindings: originalHost.bindings });
    await bounded(originalHost.callbackEntered.promise, "original callback");
    const serialized = await bounded(
      dump(originalExecution, { mode: "replay" }),
      "external capture"
    );
    await completeOriginal(originalHost);
    const original = await bounded(originalExecution, "original completion");
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(deepCopyFromSandbox(original.returnValue)).toEqual(control.expected);
    const receipt = original.snapshot.hostCalls?.find((record) => record.operation === "start");
    if (receipt?.outcome?.status !== "fulfilled") throw new Error("Missing original host receipt");
    const outcome = {
      status: "fulfilled",
      value: deepCopyToSandbox(deepCopyFromSandbox(receipt.outcome.value))
    } as const;
    const resumedHost = hosts();
    const proofReturned = deferred<void>();
    const events: unknown[] = [];
    const resumedExecution = run(control.source, {
      snapshot: restore(JSON.parse(serialized), { source: control.source }),
      bindings: resumedHost.bindings,
      hostCallResumeProvider(request, context): HostCallResumeProof {
        expect([
          request.callId,
          request.sourceHash,
          request.moduleId,
          request.operation,
          request.argumentDigest
        ]).toEqual([
          receipt.id,
          receipt.sourceHash,
          receipt.moduleId,
          receipt.operation,
          receipt.argumentDigest
        ]);
        events.push({
          request,
          callbacks: context ? [...context.callbacks.keys()] : [],
          replayed: context?.replayed.map((entry) => entry.callbackId)
        });
        proofReturned.release();
        return {
          callId: request.callId,
          sourceHash: request.sourceHash,
          moduleId: request.moduleId,
          operation: request.operation,
          argumentDigest: request.argumentDigest,
          callbackDisposition: control.callbackDisposition,
          outcome
        };
      }
    });
    await bounded(proofReturned.promise, "proof returned");
    if (control.callbackDisposition === "detached")
      await bounded(resumedHost.finishEntered.promise, "detached progress before callback release");
    else {
      for (let turn = 0; turn < 32; turn++) await Promise.resolve();
      expect(resumedHost.finishReached()).toBe(false);
    }
    resumedHost.callbackGate.release();
    await bounded(resumedHost.finishEntered.promise, "resumed finish");
    resumedHost.finishGate.release();
    const resumed = await bounded(resumedExecution, "resumed completion");
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(deepCopyFromSandbox(resumed.returnValue)).toEqual(control.expected);
    expect(resumed.snapshot.hostCalls?.find((record) => record.id === receipt.id)?.lifecycle).toBe(
      "consumed"
    );
    console.log(
      JSON.stringify({ id: control.id, serialized, events, completed: await dump(resumed) })
    );
  }
);
