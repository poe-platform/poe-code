import { normalizeClosureResult } from "./async.js";
import { attachErrorSpan, replaceErrorStack, type ErrorSourceSpan } from "../error/shape.js";
import { SandboxError, type Budget } from "./budget.js";
import { createSubsetErrorValue } from "./exceptions.js";
import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import type { PendingHostCallPolicyMode } from "../snapshot/policy.js";
import {
  digestHostCallArguments,
  HostCallResumabilityError,
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
  isSandboxClosure,
  isSandboxPromise,
  measureSandboxData,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";
import { enterRunningState } from "./running-state.js";
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

type HostBridgeOptions = {
  budget: Budget;
  hostCalls?: HostCallJournal;
  moduleId?: string;
  signal?: AbortSignal;
  lifecycle?: RunLifecycle;
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
  policy: PendingHostCallPolicyMode
): TFunction {
  hostOperationPolicies.set(operation, policy);
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
  const state = { seen: new WeakMap<object, SandboxValue>() };
  const copied = Object.fromEntries(
    Object.entries(bindings).map(([name, value]) => [
      name,
      typeof value === "function"
        ? wrapCallerInjectedFunction(name, value, options, state)
        : copyHostValueToSandbox(value, [], options, state, "<root>")
    ])
  );
  options.budget.provisionDataUsage(measureSandboxData(Object.values(copied)));
  return copied;
}

function wrapCallerInjectedFunction(
  name: string,
  value: CallerInjectedFunction,
  options: HostBridgeOptions,
  state: { seen: WeakMap<object, SandboxValue> }
): SandboxValue {
  const bindingName = name === "default" && value.name.length > 0 ? value.name : name;
  const callable = value as (...args: readonly unknown[]) => unknown;
  const properties = copyFunctionProperties(callable, [], options, state, bindingName);

  return createSandboxClosure({
    ...(isAsyncFunction(callable) ? { async: true as const } : {}),
    call: (args, context) => {
      try {
        const stackFrames = context?.stack ?? [];
        const hostArgs = args.map((arg) =>
          deepCopyFromSandbox(arg, {
            wrapClosure: (closure) =>
              wrapSandboxClosureForHost(closure, stackFrames, options.budget)
          })
        );

        const policy = readHostOperationPolicy(value) ?? "re-issue";
        const hostCalls = options.hostCalls;
        const operation = bindingName;
        const moduleId = options.moduleId ?? "<bindings>";
        if (hostCalls === undefined) {
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
        return executeHostCall(
          issued.record,
          issued.restored,
          () => invokeHostCallback(() => Reflect.apply(callable, undefined, hostArgs), options),
          stackFrames,
          options,
          context?.span
        );
      } catch (error) {
        if (isFatalBridgeError(error)) {
          throw error;
        }

        throw createHostErrorValue(error, context?.stack ?? [], options.budget, context?.span);
      }
    },
    name: bindingName,
    ...(properties ? { properties } : {})
  });
}

function invokeHostCallback(invoke: () => unknown, options: HostBridgeOptions): unknown {
  const lifecycle = options.lifecycle;
  if (lifecycle === undefined) {
    return invoke();
  }

  lifecycle.hostCallbackDepth += 1;
  try {
    const result = invoke();
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
  span?: ErrorSourceSpan
): SandboxValue {
  const hostCalls = options.hostCalls as HostCallJournal;
  if (
    restored &&
    record.policy === "read-side-effect" &&
    record.lifecycle === "consumed" &&
    record.outcome !== undefined
  ) {
    return createReplayedHostCallResult(record.outcome);
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
    return createHostCallPromise(record, hostCalls.reconcile(record), hostCalls);
  }

  hostCalls.start(record);
  let result: unknown;
  try {
    result = invoke();
  } catch (error) {
    const reason = createHostErrorValue(error, stackFrames, options.budget, span);
    hostCalls.settle(record, { status: "rejected", reason });
    throw error;
  }

  if (!isPromiseLike(result)) {
    const value = copyHostResultToSandbox(result, stackFrames, options);
    hostCalls.settle(record, { status: "fulfilled", value });
    hostCalls.consume(record);
    return value;
  }

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

function createReplayedHostCallResult(outcome: HostCallOutcome): SandboxValue {
  const promise =
    outcome.status === "fulfilled"
      ? Promise.resolve(outcome.value)
      : Promise.reject(outcome.reason);
  promise.catch(() => undefined);
  return createSandboxPromise(promise);
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
    options,
    {
      seen: new WeakMap()
    },
    "<root>"
  );
  options.budget.provisionDataUsage(measureSandboxData([value]));
  return value;
}

function createHostErrorValue(
  reason: unknown,
  stackFrames: readonly string[],
  budget: Budget,
  span?: ErrorSourceSpan
): SandboxObject {
  const error =
    reason instanceof Error
      ? createSubsetErrorValue(reason.name, reason.message, stackFrames, budget, {
          cause: reason,
          chargeBudget: false
        })
      : createSubsetErrorValue("Error", describeThrownReason(reason), stackFrames, budget, {
          chargeBudget: false
        });

  if (reason instanceof Error) {
    copyHostErrorMetadata(error, reason, budget);
  }

  attachErrorSpan(error, span);
  return error;
}

function copyHostErrorMetadata(error: SandboxObject, reason: Error, budget: Budget): void {
  const resumeChecks = budget.suspendChecks();

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
    resumeChecks();
  }
}

function wrapSandboxClosureForHost(
  closure: SandboxClosure,
  stackFrames: readonly string[],
  budget: Budget
): (...args: readonly unknown[]) => Promise<unknown> {
  return async (...args) => {
    const leaveRunning = enterRunningState(closure);
    const leaveCall = budget.enterCall();
    const wrapClosure = (nestedClosure: SandboxClosure) =>
      wrapSandboxClosureForHost(nestedClosure, stackFrames, budget);

    try {
      const sandboxArgs = args.map((arg) => deepCopyToSandbox(arg));
      let result: ReturnType<SandboxClosure["call"]>;
      try {
        result = closure.call(sandboxArgs, {
          stack: stackFrames,
          thisValue: undefined
        });
      } catch (error) {
        if (isSandboxLikeValue(error)) {
          throw deepCopyFromSandbox(error, {
            wrapClosure
          });
        }

        throw error;
      }

      return await (deepCopyFromSandbox(normalizeClosureResult(result, budget), {
        wrapClosure
      }) as Promise<unknown>);
    } finally {
      leaveCall();
      leaveRunning();
    }
  };
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

function copyHostValueToSandbox(
  value: unknown,
  stackFrames: readonly string[],
  options: HostBridgeOptions,
  state: {
    seen: WeakMap<object, SandboxValue>;
  },
  path: string
): SandboxValue {
  const { budget } = options;

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

  if (isSandboxClosure(value) || isSandboxPromise(value)) {
    return deepCopyToSandbox(value);
  }

  if (typeof value === "function") {
    const callable = value as (...args: readonly unknown[]) => unknown;
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const properties = copyFunctionProperties(callable, stackFrames, options, state, path);
    const wrapped = createSandboxClosure({
      ...(isAsyncFunction(callable) ? { async: true as const } : {}),
      call: (args, context) => {
        try {
          const nestedStackFrames = context?.stack ?? [];
          const hostArgs = args.map((arg) =>
            deepCopyFromSandbox(arg, {
              wrapClosure: (closure) =>
                wrapSandboxClosureForHost(closure, nestedStackFrames, budget)
            })
          );

          return copyHostResultToSandbox(
            Reflect.apply(callable, undefined, hostArgs),
            nestedStackFrames,
            options
          );
        } catch (error) {
          if (isFatalBridgeError(error)) {
            throw error;
          }

          throw createHostErrorValue(error, context?.stack ?? [], budget, context?.span);
        }
      },
      name: callable.name.length > 0 ? callable.name : readPathName(path),
      ...(properties ? { properties } : {})
    });

    state.seen.set(value, wrapped);
    return wrapped;
  }

  if (isPromiseLike(value)) {
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

    value.forEach((entry, index) => {
      copy[index] = copyHostValueToSandbox(entry, stackFrames, options, state, `${path}[${index}]`);
    });

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
      copy.entries.set(
        copyHostValueToSandbox(key, stackFrames, options, state, `${path}.<key>`),
        copyHostValueToSandbox(entry, stackFrames, options, state, `${path}.<value>`)
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
        copyHostValueToSandbox(entry, stackFrames, options, state, `${path}.<value>`)
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
          options,
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
      options,
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
