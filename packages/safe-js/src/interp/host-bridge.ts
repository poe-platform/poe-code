import { normalizeClosureResult } from "./async.js";
import { copyNativeDate } from "./date.js";
import { exportHostCapability, importHostCapability, isLiveCapability } from "./host-capabilities.js";
import { attachErrorSpan, replaceErrorStack, type ErrorSourceSpan } from "../error/shape.js";
import { SandboxError, type Budget, type CompileOwner } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import {
  checkFloat32Allocation,
  copyFloat32Storage,
  float32DataProperties,
  float32Storage,
  isFloat32Array
} from "./float32.js";
import { createSubsetErrorValue } from "./exceptions.js";
import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import {
  readRegisteredPendingHostCallPolicy,
  type PendingHostCallPolicyMode
} from "../snapshot/policy.js";
import {
  digestHostCallArguments,
  HostCallResumabilityError,
  UnresolvedReplayCapabilityError,
  type HostCallJournal,
  type HostCallOutcome,
  type HostCallRecord
} from "./host-call.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxPromise,
  createSandboxSet,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  defineOwnDataProperty,
  isArrayIndexKey,
  isSandboxClosure,
  isSandboxPromise,
  measureSandboxData,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";
import { enterRunningState } from "./running-state.js";
import { promiseReplayContext } from "./promise-replay.js";
import { hostErrorData, sandboxErrorTypes } from "../error/shape.js";
import { decodeReplayData, encodeReplayData, type ReplayData } from "../snapshot/replay-data.js";
import type { RunLifecycle } from "../snapshot/dump.js";

const AsyncFunction = (async () => undefined).constructor;

const hostErrorMetadata = {
  code: "string",
  dest: "string",
  errno: "number",
  path: "string",
  syscall: "string"
} as const;

type CallerInjectedFunction = {
  bivarianceHack(...args: readonly unknown[]): unknown;
}["bivarianceHack"];

const hostOperationPolicies = new WeakMap<CallerInjectedFunction, PendingHostCallPolicyMode>();
const hostOperationReplayHandlers = new WeakMap<
  CallerInjectedFunction,
  (args: readonly unknown[], outcome: HostCallOutcome) => void
>();

export type RealmBridge = {
  readonly owner: object;
  assertActive(): void;
  wrapCallback(closure: SandboxClosure): (...args: readonly unknown[]) => Promise<unknown>;
  invoke(operation: CallerInjectedFunction, call: () => unknown): unknown;
  awaitResult(operation: CallerInjectedFunction): boolean;
  captureArguments(operation: CallerInjectedFunction, args: readonly SandboxValue[], copy: (values: readonly SandboxValue[]) => unknown[]): { args: unknown[]; rollback(): void };
};

export type HostBridgeOptions = {
  realm?: RealmBridge;
  registerCapabilities?: boolean;
  capabilityPath?: readonly string[];
  budget: Budget;
  compileOwner?: CompileOwner;
  hostCalls?: HostCallJournal;
  moduleId?: string;
  operation?: string;
  signal?: AbortSignal;
  lifecycle?: RunLifecycle;
  proofFunctions?: WeakMap<object, SandboxClosure>;
};

type HostCallbacks = {
  record?: HostCallRecord;
  journal?: HostCallJournal;
  entries: Map<number, (args: SandboxValue[], token?: string) => Promise<unknown>>;
  hostFunctions: Map<number, (...args: readonly unknown[]) => Promise<unknown>>;
  sourceFunctions: Map<number, SandboxClosure>;
  proofFunctions: WeakMap<object, SandboxClosure>;
  active: Set<Promise<unknown>>;
  seen: WeakMap<SandboxClosure, (...args: readonly unknown[]) => Promise<unknown>>;
  nextReissuedInvocation?: number;
  restored: Array<{ id: number; arguments: ReplayData; result: Promise<unknown> }>;
};

export type CallerInjectedBinding =
  | SandboxValue
  | CallerInjectedFunction
  | readonly CallerInjectedBinding[]
  | {
      readonly [key: string]: CallerInjectedBinding;
    };

export function declareHostOperation<TFunction extends CallerInjectedFunction>(
  operation: TFunction,
  policy: PendingHostCallPolicyMode,
  options: { onReplay?: (args: readonly unknown[], outcome: HostCallOutcome) => void } = {}
): TFunction {
  hostOperationPolicies.set(operation, policy);
  if (options.onReplay !== undefined) hostOperationReplayHandlers.set(operation, options.onReplay);
  return operation;
}

export function readHostOperationPolicy(
  operation: CallerInjectedFunction
): PendingHostCallPolicyMode | undefined {
  return hostOperationPolicies.get(operation);
}

export function wrapCallerInjectedBindings(
  bindings: Record<string, CallerInjectedBinding>,
  options: HostBridgeOptions
): Record<string, SandboxValue> {
  const operation = options.budget.acquireCompileOwner(false, options.compileOwner);
  options = { ...options, registerCapabilities: true, compileOwner: operation.owner };
  try {
    const state = { seen: new WeakMap<object, SandboxValue>() };
    const copied = Object.fromEntries(
      Object.entries(bindings).map(([name, value]) => [
        name,
        typeof value === "function" && !isLiveCapability(value)
          ? wrapCallerInjectedFunction(name, value, { ...options, capabilityPath: [name] }, state)
          : copyHostValueToSandbox(
              value,
              [],
              { ...options, operation: name, capabilityPath: [name] },
              state,
              "<root>"
            )
      ])
    );
    options.budget.chargeDataUsage(measureSandboxData(Object.values(copied)));
    return copied;
  } finally {
    operation.release();
  }
}

function wrapCallerInjectedFunction(
  name: string,
  value: CallerInjectedFunction,
  options: HostBridgeOptions,
  state: { seen: WeakMap<object, SandboxValue> }
): SandboxValue {
  const existing = state.seen.get(value) ?? options.hostCalls?.nativeClosures.get(value);
  if (existing !== undefined) return existing;
  const bindingName = name === "default" && value.name.length > 0 ? value.name : name;
  const callable = value as (...args: readonly unknown[]) => unknown;

  return createSandboxClosure({
    ...(isAsyncFunction(callable) && !options.realm?.awaitResult(callable) ? { async: true as const } : {}),
    cancellationSignal: options.signal,
    call: (args, context) => {
      options.realm?.assertActive();
      const operationLease = options.budget.acquireCompileOwner(false, options.compileOwner);
      const compilation = new CompileScope(operationLease.owner);
      try {
        if (options.signal?.aborted) throw readAbortReason(options.signal);
        const stackFrames = context?.stack ?? [];
        const callbacks: HostCallbacks = {
          journal: options.hostCalls,
          entries: new Map(),
          hostFunctions: new Map(),
          sourceFunctions: new Map(),
          proofFunctions: new WeakMap(),
          active: new Set(),
          seen: new WeakMap(),
          restored: []
        };
        const copyArguments = (values: readonly SandboxValue[]) => deepCopyFromSandbox([...values], {
          compilation,
          unwrapHostObject: options.realm === undefined ? undefined : object => exportHostCapability(object, options.realm!.owner),
          wrapClosure: (closure) =>
            options.realm?.wrapCallback(closure) ?? wrapSandboxClosureForHost(
              closure,
              stackFrames,
              options.budget,
              operationLease.owner,
              callbacks
            )
        }) as unknown[];
        const captured = options.realm?.captureArguments(callable, args, copyArguments);
        const hostArgs = captured?.args ?? copyArguments(args);

        const hostCalls = options.hostCalls;
        const operation = options.operation ?? bindingName;
        const moduleId = options.moduleId ?? "<bindings>";
        const policy =
          readHostOperationPolicy(value) ??
          readRegisteredPendingHostCallPolicy(moduleId, operation) ??
          "re-issue";
        if (hostCalls === undefined) {
          if (options.realm !== undefined) {
            let result: unknown;
            try {
              result = options.realm.invoke(callable, () => Reflect.apply(callable, undefined, hostArgs));
            } catch (error) {
              captured!.rollback();
              throw error;
            }
            if (options.realm.awaitResult(callable)) {
              return Promise.resolve(result).then(value => copyHostResultToSandbox(value, stackFrames, options));
            }
            return copyHostResultToSandbox(result, stackFrames, options);
          }
          return copyHostResultToSandbox(
            invokeHostCallback(() => Reflect.apply(callable, undefined, hostArgs), options),
            stackFrames,
            options
          );
        }

        const issued = hostCalls.issue({
          argumentDigest: digestHostCallArguments(hostArgs),
          moduleId,
          operation,
          policy
        });
        callbacks.record = issued.record;
        for (const [id, closure] of callbacks.sourceFunctions) {
          hostCalls.registerCallbackFunction(
            issued.record,
            id,
            closure,
            callbacks.hostFunctions.get(id)!
          );
        }
        if (issued.restored) {
          promiseReplayContext.getStore()?.registerCallbacks(
            (issued.record.callbacks ?? []).map((invocation, index) => {
              let resolve!: (value: unknown) => void;
              let reject!: (reason: unknown) => void;
              const result = new Promise<unknown>((resolveResult, rejectResult) => {
                resolve = resolveResult;
                reject = rejectResult;
              });
              void result.catch(() => undefined);
              callbacks.active.add(result);
              void result.then(
                () => {
                  callbacks.active.delete(result);
                },
                () => {
                  callbacks.active.delete(result);
                }
              );
              callbacks.restored.push({
                id: invocation.id,
                arguments: invocation.arguments,
                result
              });
              const token = `${issued.record.id}/callback/${index + 1}`;
              return {
                token,
                start: () => {
                  const callbackLease = options.budget.acquireCompileOwner(
                    false,
                    options.compileOwner
                  );
                  const callbackCompilation = new CompileScope(callbackLease.owner);
                  try {
                    const callback = callbacks.entries.get(invocation.id);
                    if (callback === undefined)
                      throw new TypeError("Missing restored host callback.");
                    const args = decodeReplayData(
                      invocation.arguments,
                      {
                        resolveCapability: hostCalls.resolveCapability
                      },
                      callbackCompilation
                    ) as SandboxValue[];
                    void callback(args, token)
                      .then(resolve, reject)
                      .finally(() => {
                        callbackCompilation.dispose();
                        callbackLease.release();
                      });
                  } catch (error) {
                    callbackCompilation.dispose();
                    callbackLease.release();
                    throw error;
                  }
                }
              };
            })
          );
        }
        if (issued.restored)
          hostCalls.trackCallbackCompletion(
            issued.record,
            callbacks.restored.map((invocation) => invocation.result)
          );
        return executeHostCall(
          issued.record,
          issued.restored,
          () => invokeHostCallback(() => Reflect.apply(callable, undefined, hostArgs), options),
          stackFrames,
          options,
          context?.span,
          callbacks,
          hostOperationReplayHandlers.get(value)?.bind(undefined, hostArgs)
        );
      } catch (error) {
        compilation.dispose();
        if (
          isFatalBridgeError(error) ||
          (typeof error === "object" && error !== null && sandboxErrorTypes.has(error))
        ) {
          throw error;
        }

        throw createHostErrorValue(error, context?.stack ?? [], options.budget, context?.span);
      } finally {
        compilation.dispose();
        operationLease.release();
      }
    },
    name: bindingName,
    properties: (closure) => {
      state.seen.set(value, closure);
      if (options.registerCapabilities) {
        options.hostCalls?.registerHostCapability(
          JSON.stringify([
            options.moduleId ?? "<bindings>",
            ...(options.capabilityPath ?? [bindingName])
          ]),
          closure,
          value
        );
      }
      return (
        copyFunctionProperties(callable, [], options, state, options.operation ?? bindingName) ?? {}
      );
    }
  });
}

function invokeHostCallback(invoke: () => unknown, options: HostBridgeOptions): unknown {
  const lifecycle = options.lifecycle;
  if (lifecycle === undefined) {
    return invoke();
  }

  lifecycle.hostCallbackDepth += 1;
  try {
    const result = lifecycle.hostCallbackContext.run(true, invoke);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(() => {
        lifecycle.hostCallbackDepth -= 1;
      });
    }
    lifecycle.hostCallbackDepth -= 1;
    return result;
  } catch (error) {
    lifecycle.hostCallbackDepth -= 1;
    throw error;
  }
}

function executeHostCall(
  record: HostCallRecord,
  restored: boolean,
  invoke: () => unknown,
  stackFrames: readonly string[],
  options: HostBridgeOptions,
  span?: ErrorSourceSpan,
  callbacks?: HostCallbacks,
  onReplay?: (outcome: HostCallOutcome) => void
): SandboxValue {
  const hostCalls = options.hostCalls as HostCallJournal;
  let replayed: HostCallOutcome | undefined;
  try {
    replayed = restored ? hostCalls.replayOutcome(record) : undefined;
  } catch (error) {
    if (!(error instanceof UnresolvedReplayCapabilityError) || !record.asynchronous) throw error;
    const promise = (async () => {
      let missing = error;
      while (true) {
        await hostCalls.waitForCapability(missing.id);
        try {
          const outcome = hostCalls.replayOutcome(record);
          if (outcome === undefined) throw new TypeError("Missing restored host outcome.");
          restoreReplayedHostState(record, outcome, onReplay);
          if (outcome.status === "rejected") throw outcome.reason;
          return outcome.value;
        } catch (error) {
          if (!(error instanceof UnresolvedReplayCapabilityError)) throw error;
          missing = error;
        }
      }
    })();
    void promise.catch(() => undefined);
    return createSandboxPromise(promise, { hostCall: record, hostCallJournal: hostCalls });
  }
  if (replayed !== undefined) {
    restoreReplayedHostState(record, replayed, onReplay);
    if (record.asynchronous) return createReplayedHostCallResult(replayed, record, hostCalls);
    if (replayed.status === "rejected") throw replayed.reason;
    return replayed.value;
  }
  if (
    restored &&
    record.policy === "read-side-effect" &&
    record.lifecycle === "consumed" &&
    record.outcome !== undefined
  ) {
    return createReplayedHostCallResult(record.outcome, record, hostCalls);
  }
  if (
    restored &&
    record.policy === "read-side-effect" &&
    record.lifecycle === "settled" &&
    record.outcome !== undefined
  ) {
    return createHostCallPromise(record, Promise.resolve(record.outcome), hostCalls);
  }
  if (restored && record.lifecycle === "cancelled" && record.policy === "read-side-effect") {
    throw new HostCallResumabilityError(
      record,
      "reset",
      `Host call ${record.id} was cancelled; reset is required.`
    );
  }
  if (restored && record.policy === "read-side-effect" && record.lifecycle !== "created") {
    let active = true;
    const context =
      callbacks === undefined
        ? undefined
        : {
            callbacks: new Map(callbacks.hostFunctions),
            replayed: callbacks.restored.map((invocation) => ({
              callbackId: invocation.id,
              result: invocation.result
            })),
            async waitForCallbacks() {
              while (callbacks.active.size > 0) await Promise.allSettled([...callbacks.active]);
            },
            toSandboxValue(value: unknown): SandboxValue {
              if (!active) throw new TypeError("Host call resume context is no longer active.");
              if (options.signal?.aborted) throw readAbortReason(options.signal);
              return copyHostValueToSandbox(
                value,
                stackFrames,
                { ...options, proofFunctions: callbacks.proofFunctions },
                { seen: new WeakMap() },
                "<root>"
              );
            }
          };
    const outcome = hostCalls.reconcile(record, context).finally(() => {
      active = false;
    });
    return createHostCallPromise(record, outcome, hostCalls);
  }

  if (restored && callbacks !== undefined) callbacks.nextReissuedInvocation = 0;
  hostCalls.start(record);
  let result: unknown;
  try {
    result = invoke();
  } catch (error) {
    if (error instanceof HostCallResumabilityError) {
      throw error;
    }

    const reason = createHostErrorValue(error, stackFrames, options.budget, span);
    hostCalls.settle(record, { status: "rejected", reason });
    throw error;
  }

  if (!isPromiseLike(result)) {
    record.asynchronous = false;
    const value = copyHostResultToSandbox(result, stackFrames, options);
    hostCalls.settle(record, { status: "fulfilled", value });
    hostCalls.consume(record);
    return value;
  }

  record.asynchronous = true;
  const outcome = wrapHostPromiseWithSignal(Promise.resolve(result), options.signal).then(
    (value): HostCallOutcome => {
      try {
        return {
          status: "fulfilled",
          value: copyHostResultToSandbox(value, stackFrames, options)
        };
      } catch (error) {
        if (isFatalBridgeError(error)) {
          throw error;
        }

        return {
          status: "rejected",
          reason: createHostErrorValue(error, stackFrames, options.budget, span)
        };
      }
    },
    (error): HostCallOutcome | Promise<never> => {
      if (isFatalBridgeError(error)) {
        return Promise.reject(error);
      }

      return {
        status: "rejected",
        reason: createHostErrorValue(error, stackFrames, options.budget, span)
      };
    }
  );
  return createHostCallPromise(record, outcome, hostCalls);
}

function restoreReplayedHostState(
  record: HostCallRecord,
  outcome: HostCallOutcome,
  onReplay: ((outcome: HostCallOutcome) => void) | undefined
): void {
  try {
    const result = onReplay?.(outcome);
    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => undefined);
      throw new TypeError("Host replay state hooks must complete synchronously.");
    }
  } catch (reason) {
    const error = new HostCallResumabilityError(
      record,
      "reset",
      `Cannot restore host-local state for ${record.id}: ${reason instanceof Error ? reason.message : String(reason)}`
    );
    promiseReplayContext.getStore()?.fail(error);
    throw error;
  }
}

function createReplayedHostCallResult(
  outcome: HostCallOutcome,
  record: HostCallRecord,
  hostCalls: HostCallJournal
): SandboxValue {
  const promise =
    outcome.status === "fulfilled"
      ? Promise.resolve(outcome.value)
      : Promise.reject(outcome.reason);
  promise.catch(() => undefined);
  return createSandboxPromise(promise, { hostCall: record, hostCallJournal: hostCalls });
}

function createHostCallPromise(
  record: HostCallRecord,
  outcomePromise: Promise<HostCallOutcome>,
  hostCalls: HostCallJournal
): SandboxValue {
  const promise = outcomePromise.then((outcome) => {
    if (outcome.status === "rejected" && isAbortReason(outcome.reason)) {
      hostCalls.cancel(record, outcome.reason);
    } else {
      hostCalls.settle(record, outcome);
    }
    return outcome.status === "fulfilled" ? outcome.value : Promise.reject(outcome.reason);
  });
  promise.catch(() => undefined);
  return createSandboxPromise(promise, { hostCall: record, hostCallJournal: hostCalls });
}

function isAbortReason(reason: SandboxValue): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    (("name" in reason && reason.name === "AbortError") ||
      ("code" in reason && reason.code === "aborted"))
  );
}

function copyHostResultToSandbox(
  result: unknown,
  stackFrames: readonly string[],
  options: HostBridgeOptions
): SandboxValue {
  const value = copyHostValueToSandbox(
    result,
    stackFrames,
    { ...options, registerCapabilities: false },
    {
      seen: new WeakMap()
    },
    "<root>"
  );
  options.budget.chargeDataUsage(measureSandboxData([value]));
  return value;
}

function createHostErrorValue(
  reason: unknown,
  stackFrames: readonly string[],
  budget: Budget,
  span?: ErrorSourceSpan,
  state: { seen: WeakMap<object, SandboxValue> } = { seen: new WeakMap() },
  chargeBudget = false
): SandboxObject {
  if (reason instanceof Error) {
    const existing = state.seen.get(reason);
    if (existing !== undefined) return existing as SandboxObject;
  }
  const error =
    reason instanceof Error
      ? createSubsetErrorValue(reason.name, reason.message, stackFrames, budget, {
          cause: reason,
          chargeBudget
        })
      : createSubsetErrorValue("Error", describeThrownReason(reason), stackFrames, budget, {
          chargeBudget: false
        });

  if (reason instanceof Error) {
    state.seen.set(reason, error);
    copyHostErrorMetadata(error, reason, budget, chargeBudget);
    const errors =
      reason instanceof AggregateError
        ? Object.getOwnPropertyDescriptor(reason, "errors")
        : undefined;
    const registered = hostErrorData.get(reason);
    const data =
      errors !== undefined && "value" in errors
        ? { ...registered, errors: errors.value }
        : registered;
    if (data !== undefined) {
      const copied = copyHostValueToSandbox(
        data,
        stackFrames,
        { budget, errorData: true },
        state,
        "<error>"
      ) as SandboxObject;
      Object.defineProperties(error, Object.getOwnPropertyDescriptors(copied));
      budget.chargeDataUsage(measureSandboxData([error]));
    }
  }

  attachErrorSpan(error, span);
  return error;
}

function copyHostErrorMetadata(
  error: SandboxObject,
  reason: Error,
  budget: Budget,
  chargeBudget: boolean
): void {
  const resumeChecks = chargeBudget ? undefined : budget.suspendChecks();

  try {
    for (const [key, expectedType] of Object.entries(hostErrorMetadata)) {
      const descriptor = Object.getOwnPropertyDescriptor(reason, key);
      if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
        continue;
      }

      const value = descriptor.value as unknown;
      if (typeof value !== expectedType) {
        continue;
      }

      error[key] = typeof value === "string" ? budget.allocateString(value) : (value as number);
    }
  } finally {
    resumeChecks?.();
  }
}

function wrapSandboxClosureForHost(
  closure: SandboxClosure,
  stackFrames: readonly string[],
  budget: Budget,
  compileOwner: CompileOwner,
  callbacks?: HostCallbacks
): (...args: readonly unknown[]) => Promise<unknown> {
  const existing = callbacks?.seen.get(closure);
  if (existing !== undefined) return existing;
  const id = (callbacks?.entries.size ?? 0) + 1;
  const invoke = async (sandboxArgs: SandboxValue[], token?: string) => {
    const operation = budget.acquireCompileOwner(false, compileOwner);
    const compilation = new CompileScope(operation.owner);
    let leaveRunning: (() => void) | undefined;
    let leaveCall: (() => void) | undefined;
    const wrapClosure = (nestedClosure: SandboxClosure) =>
      wrapSandboxClosureForHost(nestedClosure, stackFrames, budget, compileOwner, callbacks);

    try {
      leaveRunning = enterRunningState(closure);
      leaveCall = budget.enterCall();
      let result: ReturnType<SandboxClosure["call"]>;
      try {
        result = closure.call(sandboxArgs, {
          compilation,
          stack: stackFrames,
          thisValue: undefined
        });
      } catch (error) {
        if (isSandboxLikeValue(error)) {
          throw deepCopyFromSandbox(error, {
            compilation,
            wrapClosure
          });
        }

        throw error;
      }

      return await (deepCopyFromSandbox(normalizeClosureResult(result, budget), {
        compilation,
        wrapClosure
      }) as Promise<unknown>);
    } catch (error) {
      if (isFatalBridgeError(error)) promiseReplayContext.getStore()?.fail(error);
      throw error;
    } finally {
      compilation.dispose();
      operation.release();
      leaveCall?.();
      leaveRunning?.();
      if (token !== undefined) promiseReplayContext.getStore()?.completeCallback(token);
    }
  };
  const wrapped = async (...args: readonly unknown[]) => {
    const operation = budget.acquireCompileOwner(false, compileOwner);
    try {
      const sandboxArgs = copyHostValueToSandbox(
        [...args],
        stackFrames,
        {
          budget,
          compileOwner,
          hostCalls: callbacks?.journal
        },
        { seen: new WeakMap() },
        "<callback>"
      ) as SandboxValue[];
      const restored =
        callbacks?.nextReissuedInvocation === undefined
          ? undefined
          : callbacks.restored[callbacks.nextReissuedInvocation++];
      if (restored !== undefined) {
        if (
          restored.id !== id ||
          JSON.stringify(
            encodeReplayData(sandboxArgs, {
              identifyCapability: callbacks?.journal?.identifyCapability
            })
          ) !== JSON.stringify(restored.arguments)
        ) {
          const error = new HostCallResumabilityError(
            callbacks!.record!,
            "external-reconciliation",
            "Host callback arguments changed while re-issuing the operation; external reconciliation is required."
          );
          promiseReplayContext.getStore()?.fail(error);
          throw error;
        }
        return await restored.result;
      }
      const replay = promiseReplayContext.getStore();
      const catchUp = replay?.waitForLiveExecution();
      if (catchUp !== undefined) await catchUp;
      const token =
        callbacks?.record === undefined
          ? undefined
          : callbacks.journal?.recordCallback(
              callbacks.record,
              id,
              sandboxArgs,
              replay?.currentStep ?? 0
            );
      if (token !== undefined) replay?.beginCallback(token);
      const pending = invoke(sandboxArgs, token);
      callbacks?.active.add(pending);
      void pending.then(
        () => {
          callbacks?.active.delete(pending);
        },
        () => {
          callbacks?.active.delete(pending);
        }
      );
      return await pending;
    } finally {
      operation.release();
    }
  };
  if (closure.length !== undefined)
    Object.defineProperty(wrapped, "length", { value: closure.length });
  callbacks?.seen.set(closure, wrapped);
  callbacks?.entries.set(id, invoke);
  callbacks?.hostFunctions.set(id, wrapped);
  callbacks?.sourceFunctions.set(id, closure);
  callbacks?.proofFunctions.set(wrapped, closure);
  if (callbacks?.record !== undefined)
    callbacks.journal?.registerCallbackFunction(callbacks.record, id, closure, wrapped);
  return wrapped;
}

function isSandboxLikeValue(value: unknown): value is SandboxValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (isSandboxClosure(value) || isSandboxPromise(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return Object.getPrototypeOf(value) === Array.prototype;
  }

  if (typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAsyncFunction(value: (...args: readonly unknown[]) => unknown): boolean {
  return value instanceof AsyncFunction;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}

function isFatalBridgeError(error: unknown): error is SandboxError | HostCallResumabilityError {
  return (
    error instanceof HostCallResumabilityError ||
    (error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry"))
  );
}

function wrapHostPromiseWithSignal<TValue>(
  promise: Promise<TValue>,
  signal: AbortSignal | undefined
): Promise<TValue> {
  if (signal === undefined) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(readAbortReason(signal));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (complete: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      complete();
    };
    const onAbort = () => {
      settle(() => reject(readAbortReason(signal)));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        settle(() => resolve(value));
      },
      (reason) => {
        settle(() => reject(reason));
      }
    );
  });
}

export function copyHostValueToSandbox(
  value: unknown,
  stackFrames: readonly string[],
  options: HostBridgeOptions & { errorData?: boolean },
  state: {
    seen: WeakMap<object, SandboxValue>;
  },
  path: string
): SandboxValue {
  const { budget } = options;

  if (isLiveCapability(value)) {
    if (options.realm === undefined || options.errorData || options.hostCalls !== undefined) throw new TypeError("Live capabilities are not portable replay or error data.");
    return importHostCapability(value as object, options.realm.owner);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return options.budget.allocateString(value);
  }

  if (value instanceof Error) {
    return createHostErrorValue(value, stackFrames, budget, undefined, state, true);
  }

  if (
    options.errorData &&
    (typeof value === "function" ||
      isSandboxClosure(value) ||
      isSandboxPromise(value) ||
      value instanceof Promise)
  ) {
    throw new TypeError("Host error data must not contain functions or promises.");
  }

  if (isSandboxClosure(value) || isSandboxPromise(value)) {
    if (options.proofFunctions !== undefined)
      throw new TypeError(`Unsupported proof value at ${path}: sandbox capability`);
    return deepCopyToSandbox(value);
  }

  if (typeof value === "function") {
    if (options.proofFunctions !== undefined) {
      const sourceClosure = options.proofFunctions.get(value);
      if (sourceClosure === undefined)
        throw new TypeError(`Unsupported proof value at ${path}: function`);
      return sourceClosure;
    }
    const sourceClosure = options.hostCalls?.nativeClosures.get(value);
    if (sourceClosure !== undefined) return sourceClosure;
    const callable = value as (...args: readonly unknown[]) => unknown;
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    return wrapCallerInjectedFunction(
      callable.name.length > 0 ? callable.name : readPathName(path),
      callable,
      {
        ...options,
        operation: path.startsWith("<root>")
          ? `${options.operation ?? "<root>"}${path.slice(6)}`
          : path
      },
      state
    );
  }

  const date = copyNativeDate(value);
  if (date !== undefined) {
    const existing = state.seen.get(value as object);
    if (existing !== undefined) return existing;
    budget.chargeDataUsage(9);
    state.seen.set(value as object, date);
    return date;
  }

  if (isFloat32Array(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    checkFloat32Allocation(Math.ceil(float32Storage(value).byteLength / 4), budget);
    const copy = copyFloat32Storage(value, state);
    state.seen.set(value, copy);
    for (const [key, descriptor] of float32DataProperties(value)) {
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyHostValueToSandbox(
          descriptor.value,
          stackFrames,
          { ...options, capabilityPath: [...(options.capabilityPath ?? []), key] },
          state,
          joinPath(path, key)
        )
      });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (!options.errorData && isPromiseLike(value)) {
    if (options.proofFunctions !== undefined)
      throw new TypeError(`Unsupported proof value at ${path}: promise`);
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const promise = wrapHostPromiseWithSignal(Promise.resolve(value), options.signal).then(
      (resolved) => {
        try {
          return copyHostValueToSandbox(
            resolved,
            stackFrames,
            options,
            {
              seen: new WeakMap()
            },
            "<root>"
          );
        } catch (error) {
          if (isFatalBridgeError(error)) {
            return Promise.reject(error);
          }

          return Promise.reject(createHostErrorValue(error, stackFrames, budget));
        }
      },
      (reason) => {
        if (isFatalBridgeError(reason)) {
          return Promise.reject(reason);
        }

        return Promise.reject(createHostErrorValue(reason, stackFrames, budget));
      }
    );
    const sandboxPromise = createSandboxPromise(promise);
    state.seen.set(value, sandboxPromise);
    const span = getBoundOtelSpan(value);
    if (span !== undefined) {
      bindOtelSpan(promise, span);
      bindOtelSpan(sandboxPromise, span);
    }
    return sandboxPromise;
  }

  if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Array(value.length) as SandboxValue[];
    state.seen.set(value, copy);
    budget.allocateArrayLength(value.length);

    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      const indexed = isArrayIndexKey(key);
      if (key === "length" || (!descriptor.enumerable && !indexed)) continue;
      const entryPath = indexed ? `${path}[${key}]` : joinPath(path, key);
      if (!("value" in descriptor)) {
        throw new TypeError(`Unsupported sandbox value at ${entryPath}: accessor property`);
      }
      defineOwnDataProperty(
        copy,
        indexed ? key : budget.allocateString(key),
        copyHostValueToSandbox(
          descriptor.value,
          stackFrames,
          { ...options, capabilityPath: [...(options.capabilityPath ?? []), key] },
          state,
          entryPath
        )
      );
    }

    return copy;
  }

  if (value instanceof Map) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createSandboxMap();
    state.seen.set(value, copy);
    budget.allocateCollectionEntries(value.size);
    for (const [key, entry] of value) {
      const ordinal = copy.entries.size;
      copy.entries.set(
        copyHostValueToSandbox(
          key,
          stackFrames,
          { ...options, capabilityPath: [...(options.capabilityPath ?? []), `key:${ordinal}`] },
          state,
          `${path}.<key>`
        ),
        copyHostValueToSandbox(
          entry,
          stackFrames,
          { ...options, capabilityPath: [...(options.capabilityPath ?? []), `value:${ordinal}`] },
          state,
          `${path}.<value>`
        )
      );
    }
    return copy;
  }

  if (value instanceof Set) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createSandboxSet();
    state.seen.set(value, copy);
    budget.allocateCollectionEntries(value.size);
    for (const entry of value) {
      copy.values.add(
        copyHostValueToSandbox(
          entry,
          stackFrames,
          {
            ...options,
            capabilityPath: [...(options.capabilityPath ?? []), String(copy.values.size)]
          },
          state,
          `${path}.<value>`
        )
      );
    }
    return copy;
  }

  if (isPlainObject(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
    state.seen.set(value, copy);

    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) {
        continue;
      }

      if ("get" in descriptor || "set" in descriptor) {
        throw new TypeError(
          `Unsupported sandbox value at ${joinPath(path, key)}: accessor property`
        );
      }

      // Charged like any other string the copy carries in: a key is as readable to the sandbox
      // as the value under it, so the same limit answers for both.
      Object.defineProperty(copy, budget.allocateString(key), {
        enumerable: true,
        configurable: true,
        writable: true,
        value: copyHostValueToSandbox(
          descriptor.value,
          stackFrames,
          { ...options, capabilityPath: [...(options.capabilityPath ?? []), key] },
          state,
          joinPath(path, key)
        )
      });
    }

    return copy;
  }

  throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}

function readAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? createAbortError();
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    const error = new DOMException("This operation was aborted", "AbortError");
    replaceErrorStack(error);
    return error;
  }

  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  replaceErrorStack(error);
  return error;
}

function describeThrownReason(reason: unknown): string {
  if (reason === undefined) {
    return "";
  }

  if (typeof reason === "string") {
    return reason;
  }

  if (
    reason === null ||
    typeof reason === "number" ||
    typeof reason === "boolean" ||
    typeof reason === "bigint" ||
    typeof reason === "symbol"
  ) {
    return String(reason);
  }

  if (typeof reason === "object") {
    const message = readStringProperty(reason, "message");
    if (message !== undefined && message.length > 0) {
      return message;
    }

    const name = readStringProperty(reason, "name");
    if (name !== undefined && name.length > 0) {
      return name;
    }
  }

  try {
    return String(reason);
  } catch {
    return Object.prototype.toString.call(reason);
  }
}

function readStringProperty(value: object, key: string): string | undefined {
  if (!Object.hasOwn(value, key)) {
    return undefined;
  }

  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}

function copyFunctionProperties(
  callable: (...args: readonly unknown[]) => unknown,
  stackFrames: readonly string[],
  options: HostBridgeOptions,
  state: {
    seen: WeakMap<object, SandboxValue>;
  },
  path: string
): SandboxObject | undefined {
  const properties: SandboxObject = {};

  for (const key of Object.getOwnPropertyNames(callable)) {
    const descriptor = Object.getOwnPropertyDescriptor(callable, key);
    if (descriptor === undefined) {
      continue;
    }
    if ("get" in descriptor || "set" in descriptor) {
      continue;
    }

    if (typeof descriptor.value !== "function") {
      continue;
    }

    properties[key] = copyHostValueToSandbox(
      descriptor.value,
      stackFrames,
      { ...options, capabilityPath: [...(options.capabilityPath ?? []), key] },
      state,
      joinPath(path, key)
    );
  }

  return Object.keys(properties).length > 0 ? properties : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function joinPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function readPathName(path: string): string {
  const segment = path.replace(/^.*\./u, "");
  return segment === "<root>" ? "host" : segment;
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "function") {
    return "function";
  }

  if (typeof value === "object") {
    const name = value.constructor?.name;
    return name && name.length > 0 ? name : "object";
  }

  return typeof value;
}
