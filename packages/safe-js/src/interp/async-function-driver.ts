import { isFatalSandboxError, type Budget } from "./budget.js";
import { createThrowCompletion } from "./exceptions.js";
import { runAsyncPrefix, runPromiseJob } from "./jobs.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability, pendingPromiseFulfillers, pendingPromiseRejectors, requiresPromiseResolution } from "./promise.js";
import { onFatalPromiseRejection, withFatalPromiseCleanup } from "./promise-tracker.js";
import { linkPromiseAggregateProducer } from "./promise-continuations.js";
import { promiseReplayContext } from "./promise-replay.js";
import { retainValues } from "./resources.js";
import { createSandboxClosure, isSandboxPromise, type SandboxCallContext, type SandboxClosure, type SandboxGenerator, type SandboxPromise, type SandboxValue } from "./values.js";

export type AsyncFunctionDriver = {
  generator?: SandboxGenerator;
  capability: {promise: SandboxPromise; resolve: SandboxClosure; reject: SandboxClosure};
  phase: "running" | "waiting" | "done";
  generation: number;
};
export const asyncFunctionDrivers = new WeakMap<object, AsyncFunctionDriver>();
export const asyncFunctionHandlers = new WeakMap<SandboxClosure, {driver: AsyncFunctionDriver; action: "fulfilled" | "rejected"; generation: number}>();
const asyncFunctionSignals = new WeakMap<AsyncFunctionDriver, AbortSignal>();
const abortReleases = new WeakMap<AsyncFunctionDriver, () => void>();

export function bindAsyncFunctionSignal(driver: AsyncFunctionDriver, signal: AbortSignal | undefined, budget: Budget, context?: SandboxCallContext): void {
  abortReleases.get(driver)?.();
  if (signal === undefined) asyncFunctionSignals.delete(driver);
  else asyncFunctionSignals.set(driver, signal);
  if (driver.phase !== "waiting") return;
  const generation = driver.generation;
  let notify!: (reason: unknown) => void;
  const aborted = new Promise<unknown>(resolve => {notify = resolve;});
  let active = true;
  const abort = () => notify(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
  const release = () => {
    active = false;
    signal?.removeEventListener("abort", abort);
    detachFatal?.();
    if (abortReleases.get(driver) === release) abortReleases.delete(driver);
  };
  abortReleases.set(driver, release);
  signal?.addEventListener("abort", abort, {once: true});
  const detachFatal = onFatalPromiseRejection(notify);
  // Register in the current job context; the external abort callback only
  // settles this notification and never executes guest code itself.
  void aborted.then(reason => runPromiseJob(async () => {
    if (!active || driver.phase !== "waiting" || driver.generation !== generation) return;
    if (isFatalSandboxError(reason)) {
      release();
      driver.phase = "running";
      await withFatalPromiseCleanup(async () => {
        if (driver.generator?.state !== "done") await driver.generator?.channel.throw(reason);
      });
      throw reason;
    }
    const handler = createAsyncFunctionHandler(driver, "rejected", generation, budget, context);
    await handler.call([createThrowCompletion(reason, budget, context?.stack ?? []).value], context);
  })).catch(error => {
    release();
    driver.phase = "done";
    if (driver.generator !== undefined) driver.generator.state = "done";
    const reject = pendingPromiseRejectors.get(driver.capability.promise);
    if (reject === undefined) throw new TypeError("Missing async function rejection capability.");
    reject(error);
  });
  if (signal?.aborted) abort();
}

export function startAsyncFunction(initialize: (onSuspend: () => void) => Promise<SandboxGenerator>, budget: Budget, context?: SandboxCallContext, signal?: AbortSignal): SandboxPromise {
  let completePrefix!: () => void;
  let failPrefix!: (reason: unknown) => void;
  const prefix = new Promise<void>((resolve, reject) => {completePrefix = resolve; failPrefix = reject;});
  void prefix.catch(() => undefined);
  const capability = createPendingPromiseCapability(budget, context, prefix);
  const driver: AsyncFunctionDriver = {capability: {promise: capability.promise, resolve: capability.resolve, reject: capability.reject}, phase: "running", generation: 0};
  asyncFunctionDrivers.set(driver, driver);
  bindAsyncFunctionSignal(driver, signal, budget, context);
  void runAsyncPrefix(async () => {
    try {
      driver.generator = await initialize(completePrefix);
      await advanceAsyncFunction(driver, "fulfilled", undefined, budget, context);
    } catch (error) {
      driver.phase = "done";
      if (isFatalSandboxError(error)) throw error;
      await capability.reject.call([createThrowCompletion(error, budget, context?.stack ?? []).value], context);
    }
  }).then(completePrefix, error => {capability.rejectNative(error); failPrefix(error);});
  return capability.promise;
}

export function createAsyncFunctionHandler(driver: AsyncFunctionDriver, action: "fulfilled" | "rejected", generation: number, budget: Budget, context?: SandboxCallContext): SandboxClosure {
  const handler = createSandboxClosure({guest: true, sandbox: true, name: "", length: 1,
    retainedValues: () => [driver],
    call: async ([value]) => {
      if (driver.phase !== "waiting" || driver.generation !== generation) return undefined;
      abortReleases.get(driver)?.();
      driver.phase = "running";
      if (driver.generator?.state === "done") {
        driver.phase = "done";
        const settle = (action === "fulfilled" ? pendingPromiseFulfillers : pendingPromiseRejectors).get(driver.capability.promise);
        if (settle === undefined) throw new TypeError("Missing async function settlement capability.");
        settle(value);
        return undefined;
      }
      await advanceAsyncFunction(driver, action, value, budget, context);
      return undefined;
    }
  });
  asyncFunctionHandlers.set(handler, {driver, action, generation});
  return handler;
}

async function advanceAsyncFunction(driver: AsyncFunctionDriver, action: "fulfilled" | "rejected", value: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<void> {
  const release = retainValues(budget, () => [driver]);
  try {
    const generator = driver.generator;
    if (generator === undefined) throw new TypeError("Missing async function frame.");
    generator.state = "running";
    const result = await generator.channel[action === "fulfilled" ? "next" : "throw"](value);
    if (result.done) {
      generator.state = "done";
      if (!requiresPromiseResolution(result.value as SandboxValue, budget)) {
        driver.phase = "done";
        await driver.capability.resolve.call([result.value as SandboxValue], context);
        return;
      }
    } else {
      generator.state = "suspended";
    }
    const prepared = result.value as SandboxValue;
    let awaited: SandboxPromise;
    if (!result.done && isSandboxPromise(prepared)) awaited = prepared;
    else {
      const wrapper = promiseReplayContext.exit(() => createPendingPromiseCapability(budget, context));
      await wrapper.resolve.call([prepared], context);
      awaited = wrapper.promise;
    }
    driver.phase = "waiting";
    driver.generation++;
    bindAsyncFunctionSignal(driver, asyncFunctionSignals.get(driver), budget, context);
    const reaction = promiseReplayContext.exit(() => createPendingPromiseCapability(budget, context));
    attachPendingPromiseReaction(awaited, reaction,
      createAsyncFunctionHandler(driver, "fulfilled", driver.generation, budget, context),
      createAsyncFunctionHandler(driver, "rejected", driver.generation, budget, context), budget, context);
    linkPromiseAggregateProducer(reaction.promise, driver.capability.promise);
  } catch (error) {
    abortReleases.get(driver)?.();
    driver.phase = "done";
    if (driver.generator !== undefined) driver.generator.state = "done";
    if (isFatalSandboxError(error)) throw error;
    await driver.capability.reject.call([createThrowCompletion(error, budget, context?.stack ?? []).value], context);
  } finally {release();}
}
