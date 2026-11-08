import { readPropertyDescriptor } from "./accessors.js";
import type { ParseResult } from "../parse.js";
import { suspendAsyncFunctionValue, type AsyncSuspensionContext } from "./async.js";
import { advanceAsyncCleanup, asyncCleanupStates, type AsyncCleanupState, type AsyncDisposableResource } from "./async-disposable-stack.js";
import { isFatalSandboxError, type Budget } from "./budget.js";
import { awaitSandboxValue } from "./cancel.js";
import { createDataCheckpoint } from "./data-checkpoint.js";
import { createThrowCompletion, type CompletionResult, type EvaluationResult } from "./exceptions.js";
import { HostCallResumabilityError } from "./host-call.js";
import { suspendJob } from "./jobs.js";
import { getSandboxPropertyDescriptor } from "./object-model.js";
import { createPendingPromiseCapability } from "./promise.js";
import { observeSandboxPromise } from "./promise-tracker.js";
import { retainValues } from "./resources.js";
import type { Scope } from "./scope.js";
import { wellKnownSymbols } from "./symbols.js";
import { isSandboxClosure, type SandboxCallContext, type SandboxValue } from "./values.js";

export type ResourceScopeState = {
  resources: AsyncDisposableResource[];
  cleanup?: AsyncCleanupState;
  completion?: Omit<CompletionResult, "stackFrames"> & {stackFrames?: string[]};
};

export function resourceSuspension(context: AsyncSuspensionContext, node: ParseResult): {awaitResource?: (value: SandboxValue) => Promise<SandboxValue>; resumeResource?: boolean} {
  return context.asyncFunction || context.asyncGeneratorFrame !== undefined ? {
    awaitResource: value => suspendAsyncFunctionValue(value, node, context),
    resumeResource: context.generatorResume?.completed !== true && context.generatorResume?.yieldNodeId === node.nodeId
  } : {};
}

export function assertResourceScopeState(value: unknown): asserts value is ResourceScopeState {
  const state = dataRecord(value, ["resources"], ["cleanup", "completion"]);
  if (!Array.isArray(state.resources)) throw new TypeError("Invalid scope resources.");
  for (const entry of state.resources) {
    const resource = dataRecord(entry, ["method", "receiver", "args", "syncFallback"], ["synchronous"]);
    if (!Array.isArray(resource.args) || resource.args.length !== 0 || typeof resource.syncFallback !== "boolean" ||
        (resource.synchronous !== undefined && (resource.synchronous !== true || resource.syncFallback)))
      throw new TypeError("Invalid scope resource record.");
    if (resource.method === undefined) {
      if (resource.receiver !== undefined || resource.syncFallback || resource.synchronous) throw new TypeError("Invalid nullish scope resource.");
    } else if (!isSandboxClosure(resource.method)) throw new TypeError("Invalid scope disposer.");
  }
  if (state.cleanup !== undefined) {
    if (state.resources.length !== 0 || typeof state.cleanup !== "object" || state.cleanup === null ||
        asyncCleanupStates.get(state.cleanup) !== state.cleanup) throw new TypeError("Invalid scope cleanup ownership.");
    const completion = dataRecord(state.completion, ["kind", "hasValue", "value"], ["span", "stackFrames", "label", "node"]);
    if (!["normal", "return", "throw", "break", "continue"].includes(String(completion.kind)) || typeof completion.hasValue !== "boolean")
      throw new TypeError("Invalid scope cleanup completion.");
  } else if (state.completion !== undefined) throw new TypeError("Unowned scope completion.");
}

function dataRecord(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invalid scope resource state.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => descriptors[key] === undefined) || Reflect.ownKeys(descriptors).some(key =>
    typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!)))
    throw new TypeError("Invalid scope resource fields.");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

export async function registerScopeResource(scope: Scope, value: SandboxValue, hint: "sync" | "async", budget: Budget, context?: SandboxCallContext): Promise<void> {
  if (hint === "sync" && (value === null || value === undefined)) return;
  const state = scope.resourceState ??= {resources: []};
  if (value === null || value === undefined) {
    state.resources.push({method: undefined, receiver: undefined, args: [], syncFallback: false});
    createDataCheckpoint(budget, context)(state, 0, true);
    return;
  }
  if (typeof value !== "object") throw new TypeError("Disposable resource must be an object.");
  const read = async (key: symbol): Promise<SandboxValue> => {
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  };
  let method = await read(hint === "async" ? wellKnownSymbols.asyncDispose : wellKnownSymbols.dispose);
  let syncFallback = false;
  if (hint === "async" && (method === undefined || method === null)) {
    method = await read(wellKnownSymbols.dispose);
    syncFallback = true;
  }
  if (!isSandboxClosure(method)) throw new TypeError("Disposer must be callable.");
  state.resources.push({method, receiver: value, args: [], syncFallback, ...(hint === "sync" ? {synchronous: true} : {})});
  createDataCheckpoint(budget, context)(state, 0, true);
}

export async function evaluateResourceScope<TError>(scope: Scope, budget: Budget, context: (SandboxCallContext & {onSuspend?: () => void; signal?: AbortSignal; awaitResource?: (value: SandboxValue) => Promise<SandboxValue>; resumeResource?: boolean}) | undefined,
  body: () => Promise<EvaluationResult<TError>>): Promise<EvaluationResult<TError>> {
  let completion: EvaluationResult<TError>;
  try {
    completion = scope.resourceState?.completion ?? await body();
  } catch (error) {
    if (scope.resourceState === undefined || isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
    completion = createThrowCompletion(error, budget, context?.stack ?? []);
  }
  const state = scope.resourceState;
  if (state === undefined || (state.resources.length === 0 && state.cleanup === undefined)) return completion;
  if (completion.kind === "error") return completion;
  state.completion = {...completion, ...(completion.stackFrames === undefined ? {stackFrames: undefined} : {stackFrames: [...completion.stackFrames]})};
  const release = retainValues(budget, () => [state]);
  try {
    if (state.cleanup === undefined) {
      const capability = createPendingPromiseCapability(budget, context);
      const cleanup: AsyncCleanupState = {resources: state.resources,
        capability: {promise: capability.promise, resolve: capability.resolve, reject: capability.reject},
        phase: "running", failed: completion.kind === "throw", failure: completion.kind === "throw" ? completion.value : undefined,
        needsAwait: false, hasAwaited: false, generation: 0};
      state.resources = [];
      state.cleanup = cleanup;
      asyncCleanupStates.set(cleanup, cleanup);
      await advanceAsyncCleanup(cleanup, budget, context);
    }
    const cleanup = state.cleanup;
    try {
      if (context?.awaitResource !== undefined) {
        if (cleanup.phase !== "done" || context.resumeResource) await context.awaitResource(cleanup.capability.promise);
        else observeSandboxPromise(cleanup.capability.promise, true);
      } else {
        const settled = awaitSandboxValue(cleanup.capability.promise, context?.signal, budget, context);
        if (cleanup.phase === "done") await settled;
        else {context?.onSuspend?.(); await suspendJob(settled);}
      }
    } catch (error) {
      if (cleanup.phase !== "done" || isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
    }
    return cleanup.failed ? {kind: "throw", hasValue: true, value: cleanup.failure} : completion;
  } finally {
    if (state.cleanup?.phase === "done") scope.resourceState = undefined;
    release();
  }
}
