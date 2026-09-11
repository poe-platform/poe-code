import { isFatalSandboxError, type Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { createSubsetErrorValue, createThrowCompletion } from "./exceptions.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability } from "./promise.js";
import { linkPromiseAggregateProducer } from "./promise-continuations.js";
import { retainValues } from "./resources.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxPromise, type SandboxValue } from "./values.js";

export type AsyncDisposableResource = {
  method: SandboxClosure | undefined;
  receiver: SandboxValue;
  args: SandboxValue[];
  syncFallback: boolean;
  synchronous?: boolean;
};
export type AsyncDisposableStackState = {disposed: boolean; resources: AsyncDisposableResource[]};
export type AsyncCleanupState = {
  resources: AsyncDisposableResource[];
  capability: {promise: SandboxPromise; resolve: SandboxClosure; reject: SandboxClosure};
  phase: "running" | "waiting" | "done";
  failed: boolean;
  failure: SandboxValue;
  needsAwait: boolean;
  hasAwaited: boolean;
  generation: number;
};
export const asyncDisposableStackStates = new WeakMap<object, AsyncDisposableStackState>();
export const asyncCleanupStates = new WeakMap<object, AsyncCleanupState>();
export const asyncCleanupHandlers = new WeakMap<SandboxClosure, {cleanup: AsyncCleanupState; action: "fulfilled" | "rejected"; generation: number}>();

export function createAsyncCleanupHandler(cleanup: AsyncCleanupState, action: "fulfilled" | "rejected", budget: Budget, context?: SandboxCallContext, generation = cleanup.generation): SandboxClosure {
  const handler = createSandboxClosure({
    guest: true, sandbox: true, name: "", length: 1,
    retainedValues: () => [cleanup],
    call: async ([value]) => {
      if (cleanup.phase !== "waiting" || cleanup.generation !== generation) return undefined;
      cleanup.phase = "running";
      if (action === "rejected") recordCleanupFailure(cleanup, value, budget, context);
      await advanceAsyncCleanup(cleanup, budget, context);
      return undefined;
    }
  });
  asyncCleanupHandlers.set(handler, {cleanup, action, generation});
  return handler;
}

export async function advanceAsyncCleanup(cleanup: AsyncCleanupState, budget: Budget, context?: SandboxCallContext): Promise<void> {
  let current: AsyncDisposableResource | undefined;
  const release = retainValues(budget, () => [cleanup,
    ...(current === undefined ? [] : [current.method, current.receiver, ...current.args])]);
  try {
    while ((current = cleanup.resources.pop()) !== undefined) {
      budget.visitNode();
      if (current.synchronous && cleanup.needsAwait && !cleanup.hasAwaited) {
        cleanup.resources.push(current);
        cleanup.needsAwait = false;
        await wait(undefined, false);
        return;
      }
      if (current.method === undefined) {cleanup.needsAwait = true; continue;}
      let result: SandboxValue;
      try {
        result = await invokeBuiltinClosure(current.method, current.args, budget, context, current.receiver);
      } catch (error) {
        if (isFatalSandboxError(error)) throw error;
        const value = createThrowCompletion(error, budget, context?.stack ?? []).value;
        if (current.syncFallback && !current.synchronous) {await wait(value, true); return;}
        recordCleanupFailure(cleanup, value, budget, context);
        continue;
      }
      if (current.synchronous) continue;
      await wait(current.syncFallback ? undefined : result, false);
      return;
    }
    if (cleanup.needsAwait && !cleanup.hasAwaited) {await wait(undefined, false); return;}
    cleanup.phase = "done";
    await (cleanup.failed ? cleanup.capability.reject : cleanup.capability.resolve).call([cleanup.failure], context);
  } catch (error) {
    cleanup.phase = "done";
    if (isFatalSandboxError(error)) throw error;
    await cleanup.capability.reject.call([createThrowCompletion(error, budget, context?.stack ?? []).value], context);
  } finally {release();}

  async function wait(value: SandboxValue, rejected: boolean): Promise<void> {
    const awaited = createPendingPromiseCapability(budget, context);
    const reaction = createPendingPromiseCapability(budget, context);
    cleanup.phase = "waiting";
    cleanup.generation++;
    cleanup.hasAwaited = true;
    attachPendingPromiseReaction(awaited.promise, reaction,
      createAsyncCleanupHandler(cleanup, "fulfilled", budget, context),
      createAsyncCleanupHandler(cleanup, "rejected", budget, context), budget, context);
    linkPromiseAggregateProducer(reaction.promise, cleanup.capability.promise);
    await (rejected ? awaited.reject : awaited.resolve).call([value], context);
  }
}

function recordCleanupFailure(cleanup: AsyncCleanupState, value: SandboxValue, budget: Budget, context?: SandboxCallContext): void {
  if (cleanup.failed) {
    const combined = createSubsetErrorValue("SuppressedError", undefined, context?.stack ?? [], budget);
    Object.defineProperties(combined, {
      error: {value, writable: true, configurable: true},
      suppressed: {value: cleanup.failure, writable: true, configurable: true}
    });
    cleanup.failure = combined;
  } else {cleanup.failed = true; cleanup.failure = value;}
}
