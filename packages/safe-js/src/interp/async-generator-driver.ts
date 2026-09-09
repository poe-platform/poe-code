import { isFatalSandboxError, type Budget } from "./budget.js";
import { getGeneratorOrigin } from "./closure-origin.js";
import { createOrdinaryObject, getSandboxPrototype } from "./object-model.js";
import { createThrowCompletion } from "./exceptions.js";
import { runAsyncPrefix, runPromiseJob } from "./jobs.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability, pendingPromiseRejectors, requiresPromiseResolution } from "./promise.js";
import { linkPromiseAggregateProducer } from "./promise-continuations.js";
import { promiseReplayContext } from "./promise-replay.js";
import { onFatalPromiseRejection, withFatalPromiseCleanup } from "./promise-tracker.js";
import { retainValues } from "./resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxPromise, type SandboxCallContext, type SandboxClosure, type SandboxGenerator, type SandboxPromise, type SandboxValue } from "./values.js";

export type AsyncGeneratorRequest = {
  resultPrototype?: SandboxValue & (object | null);
  method: "next" | "return" | "throw";
  value: SandboxValue;
  capability: {promise: SandboxPromise; resolve: SandboxClosure; reject: SandboxClosure};
};
export type AsyncGeneratorDriver = {
  generator: SandboxGenerator;
  requests: AsyncGeneratorRequest[];
  phase: "idle" | "running" | "waiting";
  suspension: "await" | "yield";
  awaitKind: "body" | "return";
  generation: number;
};
export const asyncGeneratorDrivers = new WeakMap<object, AsyncGeneratorDriver>();
export const asyncGeneratorRequestOwners = new WeakMap<SandboxPromise, AsyncGeneratorDriver>();
export const asyncGeneratorHandlers = new WeakMap<SandboxClosure, {driver: AsyncGeneratorDriver; owner: SandboxPromise; action: "fulfilled" | "rejected"; generation: number}>();
const generatorSignals = new WeakMap<SandboxGenerator, AbortSignal>();
const interruptReleases = new WeakMap<AsyncGeneratorDriver, () => void>();

export function bindAsyncGeneratorSignal(generator: SandboxGenerator, signal: AbortSignal | undefined, budget: Budget, context?: SandboxCallContext): void {
  if (signal === undefined) generatorSignals.delete(generator);
  else generatorSignals.set(generator, signal);
  const driver = asyncGeneratorDrivers.get(generator);
  if (driver === undefined) return;
  interruptReleases.get(driver)?.();
  if (driver.phase !== "waiting") return;
  const generation = driver.generation;
  let notify!: (reason: unknown) => void;
  const interrupted = new Promise<unknown>(resolve => {notify = resolve;});
  let active = true;
  const abort = () => notify(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
  const release = () => {
    active = false;
    signal?.removeEventListener("abort", abort);
    detachFatal?.();
    if (interruptReleases.get(driver) === release) interruptReleases.delete(driver);
  };
  interruptReleases.set(driver, release);
  signal?.addEventListener("abort", abort, {once:true});
  const detachFatal = onFatalPromiseRejection(notify);
  void interrupted.then(reason => runPromiseJob(async () => {
    if (!active || driver.phase !== "waiting" || driver.generation !== generation) return;
    if (isFatalSandboxError(reason)) {
      release();
      driver.phase = "running";
      await withFatalPromiseCleanup(async () => {
        if (generator.state !== "done") await generator.channel.throw(reason, false);
      });
      throw reason;
    }
    const handler = createAsyncGeneratorHandler(driver, "rejected", generation, budget, context);
    await handler.call([createThrowCompletion(reason, budget, context?.stack ?? []).value], context);
  })).catch(error => rejectGeneratorQueue(driver, error));
  if (signal?.aborted) abort();
}

export function enqueueAsyncGeneratorRequest(generator: SandboxGenerator, method: AsyncGeneratorRequest["method"], value: SandboxValue, budget: Budget, context?: SandboxCallContext): SandboxPromise {
  let driver = asyncGeneratorDrivers.get(generator);
  if (driver === undefined) {
    driver = {generator, requests: [], phase: "idle", suspension: "yield", awaitKind: "body", generation: 0};
    asyncGeneratorDrivers.set(generator, driver);
    asyncGeneratorDrivers.set(driver, driver);
  }
  const startsRequest = driver.phase === "idle";
  let completePrefix: (() => void) | undefined;
  const prefix = startsRequest ? new Promise<void>(resolve => {completePrefix = resolve;}) : undefined;
  const capability = createPendingPromiseCapability(budget, context, prefix);
  driver.requests.push({method, value, resultPrototype: getSandboxPrototype({}, budget) as SandboxValue & (object | null),
    capability: {promise: capability.promise, resolve: capability.resolve, reject: capability.reject}});
  asyncGeneratorRequestOwners.set(capability.promise, driver);
  if (startsRequest) {
    driver.phase = "running";
    const active = driver;
    void runAsyncPrefix(() => advanceAsyncGenerator(active, method, value, budget, context)).then(
      () => completePrefix?.(),
      error => {rejectGeneratorQueue(active, error); completePrefix?.();}
    );
  }
  return capability.promise;
}

export function rejectGeneratorQueue(driver: AsyncGeneratorDriver, error: unknown): void {
  interruptReleases.get(driver)?.();
  driver.generator.state = "done";
  driver.phase = "idle";
  for (const request of driver.requests.splice(0)) {
    asyncGeneratorRequestOwners.delete(request.capability.promise);
    pendingPromiseRejectors.get(request.capability.promise)?.(error);
  }
}

export function createAsyncGeneratorHandler(driver: AsyncGeneratorDriver, action: "fulfilled" | "rejected", generation: number, budget: Budget, context?: SandboxCallContext, owner = driver.requests[0]?.capability.promise): SandboxClosure {
  if (owner === undefined) throw new TypeError("Missing async generator handler owner.");
  const handler = createSandboxClosure({guest: true, sandbox: true, name: "", length: 1,
    retainedValues: () => [driver, owner],
    call: async ([value]) => {
      if (driver.phase !== "waiting" || driver.generation !== generation) return undefined;
      interruptReleases.get(driver)?.();
      driver.phase = "running";
      if (driver.awaitKind === "return") await settleGeneratorRequest(driver, action, value, true, budget, context);
      else await advanceAsyncGenerator(driver, action === "fulfilled" ? "next" : "throw", value, budget, context, false);
      return undefined;
    }
  });
  asyncGeneratorHandlers.set(handler, {driver, owner, action, generation});
  return handler;
}

async function settleGeneratorRequest(driver: AsyncGeneratorDriver, action: "fulfilled" | "rejected", value: SandboxValue, done: boolean, budget: Budget, context?: SandboxCallContext): Promise<void> {
  const request = driver.requests[0];
  if (request === undefined) throw new TypeError("Missing async generator request.");
  if (action === "fulfilled") {
    const result = createOrdinaryObject(request.resultPrototype === undefined ? getSandboxPrototype({}, budget) : request.resultPrototype, {value, done});
    await request.capability.resolve.call([allocateProducedSandboxValue(result, budget)], context);
  }
  else await request.capability.reject.call([value], context);
  driver.requests.shift();
  asyncGeneratorRequestOwners.delete(request.capability.promise);
  const next = driver.requests[0];
  if (next === undefined) driver.phase = "idle";
  else {
    if (driver.generator.state === "done") next.resultPrototype = request.resultPrototype;
    await advanceAsyncGenerator(driver, next.method, next.value, budget, context);
  }
}

async function awaitGeneratorRequest(driver: AsyncGeneratorDriver, value: SandboxValue, kind: "body" | "return", budget: Budget, context?: SandboxCallContext): Promise<void> {
  let awaited: SandboxPromise;
  if (kind === "body" && isSandboxPromise(value)) awaited = value;
  else {
    const wrapper = promiseReplayContext.exit(() => createPendingPromiseCapability(budget, context));
    await wrapper.resolve.call([value], context);
    awaited = wrapper.promise;
  }
  driver.phase = "waiting";
  driver.awaitKind = kind;
  driver.generation++;
  const reaction = promiseReplayContext.exit(() => createPendingPromiseCapability(budget, context));
  attachPendingPromiseReaction(awaited, reaction,
    createAsyncGeneratorHandler(driver, "fulfilled", driver.generation, budget, context),
    createAsyncGeneratorHandler(driver, "rejected", driver.generation, budget, context), budget, context);
  const request = driver.requests[0];
  if (request === undefined) throw new TypeError("Missing async generator await owner.");
  linkPromiseAggregateProducer(reaction.promise, request.capability.promise);
  bindAsyncGeneratorSignal(driver.generator, generatorSignals.get(driver.generator), budget, context);
}

async function advanceAsyncGenerator(driver: AsyncGeneratorDriver, method: AsyncGeneratorRequest["method"], value: SandboxValue, budget: Budget, context?: SandboxCallContext, record = true): Promise<void> {
  const release = retainValues(budget, () => [driver]);
  const generator = driver.generator;
  try {
    driver.phase = "running";
    const initial = generator.state;
    if (initial === "suspended" || (initial === "start" && method === "next")) {
      const request = driver.requests[0];
      const prototype = getGeneratorOrigin(generator)?.resultPrototype;
      if (request !== undefined && prototype !== undefined) request.resultPrototype = prototype as SandboxValue & (object | null);
    }
    generator.state = "running";
    const result = await generator.channel[method](value, record);
    generator.state = result.done ? "done" : "suspended";
    const produced = result.value as SandboxValue;
    if (!result.done && driver.suspension === "await") await awaitGeneratorRequest(driver, produced, "body", budget, context);
    else if (result.done && (requiresPromiseResolution(produced, budget) || (method === "return" && (initial === "start" || initial === "done"))))
      await awaitGeneratorRequest(driver, produced, "return", budget, context);
    else await settleGeneratorRequest(driver, "fulfilled", produced, result.done === true, budget, context);
  } catch (error) {
    generator.state = "done";
    if (isFatalSandboxError(error)) {rejectGeneratorQueue(driver, error); throw error;}
    await settleGeneratorRequest(driver, "rejected", createThrowCompletion(error, budget, context?.stack ?? []).value, true, budget, context);
  } finally {release();}
}
