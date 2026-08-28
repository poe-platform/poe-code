import { normalizeClosureResult } from "./async.js";
import { attachErrorSpan, replaceErrorStack } from "../error/shape.js";
import { SandboxError } from "./budget.js";
import { createSubsetErrorValue } from "./exceptions.js";
import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import { digestHostCallArguments, HostCallResumabilityError, UnresolvedReplayCapabilityError } from "./host-call.js";
import { createSandboxClosure, createSandboxMap, createSandboxPromise, createSandboxSet, deepCopyFromSandbox, deepCopyToSandbox, isSandboxClosure, isSandboxPromise, measureSandboxData } from "./values.js";
import { enterRunningState } from "./running-state.js";
import { promiseReplayContext } from "./promise-replay.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
const AsyncFunction = (async () => undefined).constructor;
const hostErrorMetadata = {
    code: "string",
    dest: "string",
    errno: "number",
    path: "string",
    syscall: "string"
};
const hostOperationPolicies = new WeakMap();
const hostOperationReplayHandlers = new WeakMap();
export function declareHostOperation(operation, policy, options = {}) {
    hostOperationPolicies.set(operation, policy);
    if (options.onReplay !== undefined)
        hostOperationReplayHandlers.set(operation, options.onReplay);
    return operation;
}
export function readHostOperationPolicy(operation) {
    return hostOperationPolicies.get(operation);
}
export function wrapCallerInjectedBindings(bindings, options) {
    const state = { seen: new WeakMap() };
    const copied = Object.fromEntries(Object.entries(bindings).map(([name, value]) => [
        name,
        typeof value === "function"
            ? wrapCallerInjectedFunction(name, value, options, state)
            : copyHostValueToSandbox(value, [], { ...options, operation: name }, state, "<root>")
    ]));
    options.budget.provisionDataUsage(measureSandboxData(Object.values(copied)));
    return copied;
}
function wrapCallerInjectedFunction(name, value, options, state) {
    const existing = state.seen.get(value);
    if (existing !== undefined)
        return existing;
    const bindingName = name === "default" && value.name.length > 0 ? value.name : name;
    const callable = value;
    return createSandboxClosure({
        ...(isAsyncFunction(callable) ? { async: true } : {}),
        call: (args, context) => {
            try {
                const stackFrames = context?.stack ?? [];
                const callbacks = {
                    journal: options.hostCalls,
                    entries: new Map(),
                    hostFunctions: new Map(),
                    sourceFunctions: new Map(),
                    active: new Set(),
                    seen: new WeakMap(),
                    nextInvocation: 0,
                    restored: []
                };
                const hostArgs = deepCopyFromSandbox([...args], {
                    wrapClosure: (closure) => wrapSandboxClosureForHost(closure, stackFrames, options.budget, callbacks)
                });
                const policy = readHostOperationPolicy(value) ?? "re-issue";
                const hostCalls = options.hostCalls;
                const operation = options.operation ?? bindingName;
                const moduleId = options.moduleId ?? "<bindings>";
                if (hostCalls === undefined) {
                    return copyHostResultToSandbox(invokeHostCallback(() => Reflect.apply(callable, undefined, hostArgs), options), stackFrames, options);
                }
                const issued = hostCalls.issue({
                    argumentDigest: digestHostCallArguments(hostArgs),
                    moduleId,
                    operation,
                    policy
                });
                callbacks.record = issued.record;
                for (const [id, closure] of callbacks.sourceFunctions) {
                    hostCalls.registerCallbackFunction(issued.record, id, closure, callbacks.hostFunctions.get(id));
                }
                if (issued.restored) {
                    promiseReplayContext.getStore()?.registerCallbacks((issued.record.callbacks ?? []).map((invocation, index) => {
                        let resolve;
                        let reject;
                        const result = new Promise((resolveResult, rejectResult) => {
                            resolve = resolveResult;
                            reject = rejectResult;
                        });
                        void result.catch(() => undefined);
                        callbacks.active.add(result);
                        void result.then(() => {
                            callbacks.active.delete(result);
                        }, () => {
                            callbacks.active.delete(result);
                        });
                        callbacks.restored.push({
                            id: invocation.id,
                            arguments: invocation.arguments,
                            result
                        });
                        const token = `${issued.record.id}/callback/${index + 1}`;
                        return {
                            token,
                            start: () => {
                                const callback = callbacks.entries.get(invocation.id);
                                if (callback === undefined)
                                    throw new TypeError("Missing restored host callback.");
                                const args = decodeReplayData(invocation.arguments, {
                                    resolveCapability: hostCalls.resolveCapability
                                });
                                void callback(args, token).then(resolve, reject);
                            }
                        };
                    }));
                }
                if (issued.restored)
                    hostCalls.trackCallbackCompletion(issued.record, callbacks.restored.map((invocation) => invocation.result));
                return executeHostCall(issued.record, issued.restored, () => invokeHostCallback(() => Reflect.apply(callable, undefined, hostArgs), options), stackFrames, options, context?.span, callbacks, hostOperationReplayHandlers.get(value)?.bind(undefined, hostArgs));
            }
            catch (error) {
                if (isFatalBridgeError(error)) {
                    throw error;
                }
                throw createHostErrorValue(error, context?.stack ?? [], options.budget, context?.span);
            }
        },
        name: bindingName,
        properties: (closure) => {
            state.seen.set(value, closure);
            return (copyFunctionProperties(callable, [], options, state, options.operation ?? bindingName) ?? {});
        }
    });
}
function invokeHostCallback(invoke, options) {
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
    }
    catch (error) {
        lifecycle.hostCallbackDepth -= 1;
        throw error;
    }
}
function executeHostCall(record, restored, invoke, stackFrames, options, span, callbacks, onReplay) {
    const hostCalls = options.hostCalls;
    let replayed;
    try {
        replayed = restored ? hostCalls.replayOutcome(record) : undefined;
    }
    catch (error) {
        if (!(error instanceof UnresolvedReplayCapabilityError) || !record.asynchronous)
            throw error;
        const promise = (async () => {
            let missing = error;
            while (true) {
                await hostCalls.waitForCapability(missing.id);
                try {
                    const outcome = hostCalls.replayOutcome(record);
                    if (outcome === undefined)
                        throw new TypeError("Missing restored host outcome.");
                    restoreReplayedHostState(record, outcome, onReplay);
                    if (outcome.status === "rejected")
                        throw outcome.reason;
                    return outcome.value;
                }
                catch (error) {
                    if (!(error instanceof UnresolvedReplayCapabilityError))
                        throw error;
                    missing = error;
                }
            }
        })();
        void promise.catch(() => undefined);
        return createSandboxPromise(promise);
    }
    if (replayed !== undefined) {
        restoreReplayedHostState(record, replayed, onReplay);
        if (record.asynchronous)
            return createReplayedHostCallResult(replayed);
        if (replayed.status === "rejected")
            throw replayed.reason;
        return replayed.value;
    }
    if (restored &&
        record.policy === "read-side-effect" &&
        record.lifecycle === "consumed" &&
        record.outcome !== undefined) {
        return createReplayedHostCallResult(record.outcome);
    }
    if (restored &&
        record.policy === "read-side-effect" &&
        record.lifecycle === "settled" &&
        record.outcome !== undefined) {
        return createHostCallPromise(record, Promise.resolve(record.outcome), hostCalls);
    }
    if (restored && record.lifecycle === "cancelled" && record.policy === "read-side-effect") {
        throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} was cancelled; reset is required.`);
    }
    if (restored && record.policy === "read-side-effect" && record.lifecycle !== "created") {
        if (callbacks !== undefined)
            callbacks.nextInvocation = callbacks.restored.length;
        const context = callbacks === undefined
            ? undefined
            : {
                callbacks: new Map(callbacks.hostFunctions),
                replayed: callbacks.restored.map((invocation) => ({
                    callbackId: invocation.id,
                    result: invocation.result
                })),
                async waitForCallbacks() {
                    while (callbacks.active.size > 0)
                        await Promise.allSettled([...callbacks.active]);
                }
            };
        return createHostCallPromise(record, hostCalls.reconcile(record, context), hostCalls);
    }
    hostCalls.start(record);
    let result;
    try {
        result = invoke();
    }
    catch (error) {
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
    const outcome = wrapHostPromiseWithSignal(Promise.resolve(result), options.signal).then((value) => {
        try {
            return {
                status: "fulfilled",
                value: copyHostResultToSandbox(value, stackFrames, options)
            };
        }
        catch (error) {
            if (isFatalBridgeError(error)) {
                throw error;
            }
            return {
                status: "rejected",
                reason: createHostErrorValue(error, stackFrames, options.budget, span)
            };
        }
    }, (error) => {
        if (isFatalBridgeError(error)) {
            return Promise.reject(error);
        }
        return {
            status: "rejected",
            reason: createHostErrorValue(error, stackFrames, options.budget, span)
        };
    });
    return createHostCallPromise(record, outcome, hostCalls);
}
function restoreReplayedHostState(record, outcome, onReplay) {
    try {
        const result = onReplay?.(outcome);
        if (isPromiseLike(result)) {
            void Promise.resolve(result).catch(() => undefined);
            throw new TypeError("Host replay state hooks must complete synchronously.");
        }
    }
    catch (reason) {
        const error = new HostCallResumabilityError(record, "reset", `Cannot restore host-local state for ${record.id}: ${reason instanceof Error ? reason.message : String(reason)}`);
        promiseReplayContext.getStore()?.fail(error);
        throw error;
    }
}
function createReplayedHostCallResult(outcome) {
    const promise = outcome.status === "fulfilled"
        ? Promise.resolve(outcome.value)
        : Promise.reject(outcome.reason);
    promise.catch(() => undefined);
    return createSandboxPromise(promise);
}
function createHostCallPromise(record, outcomePromise, hostCalls) {
    const promise = outcomePromise.then((outcome) => {
        if (outcome.status === "rejected" && isAbortReason(outcome.reason)) {
            hostCalls.cancel(record, outcome.reason);
        }
        else {
            hostCalls.settle(record, outcome);
        }
        return outcome.status === "fulfilled" ? outcome.value : Promise.reject(outcome.reason);
    });
    promise.catch(() => undefined);
    return createSandboxPromise(promise, { hostCall: record, hostCallJournal: hostCalls });
}
function isAbortReason(reason) {
    return (typeof reason === "object" &&
        reason !== null &&
        (("name" in reason && reason.name === "AbortError") ||
            ("code" in reason && reason.code === "aborted")));
}
function copyHostResultToSandbox(result, stackFrames, options) {
    const value = copyHostValueToSandbox(result, stackFrames, options, {
        seen: new WeakMap()
    }, "<root>");
    options.budget.provisionDataUsage(measureSandboxData([value]));
    return value;
}
function createHostErrorValue(reason, stackFrames, budget, span) {
    const error = reason instanceof Error
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
function copyHostErrorMetadata(error, reason, budget) {
    const resumeChecks = budget.suspendChecks();
    try {
        for (const [key, expectedType] of Object.entries(hostErrorMetadata)) {
            const descriptor = Object.getOwnPropertyDescriptor(reason, key);
            if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
                continue;
            }
            const value = descriptor.value;
            if (typeof value !== expectedType) {
                continue;
            }
            error[key] = typeof value === "string" ? budget.allocateString(value) : value;
        }
    }
    finally {
        resumeChecks();
    }
}
function wrapSandboxClosureForHost(closure, stackFrames, budget, callbacks) {
    const existing = callbacks?.seen.get(closure);
    if (existing !== undefined)
        return existing;
    const id = (callbacks?.entries.size ?? 0) + 1;
    const invoke = async (sandboxArgs, token) => {
        let leaveRunning;
        let leaveCall;
        const wrapClosure = (nestedClosure) => wrapSandboxClosureForHost(nestedClosure, stackFrames, budget, callbacks);
        try {
            leaveRunning = enterRunningState(closure);
            leaveCall = budget.enterCall();
            let result;
            try {
                result = closure.call(sandboxArgs, {
                    stack: stackFrames,
                    thisValue: undefined
                });
            }
            catch (error) {
                if (isSandboxLikeValue(error)) {
                    throw deepCopyFromSandbox(error, {
                        wrapClosure
                    });
                }
                throw error;
            }
            return await deepCopyFromSandbox(normalizeClosureResult(result, budget), {
                wrapClosure
            });
        }
        catch (error) {
            if (isFatalBridgeError(error))
                promiseReplayContext.getStore()?.fail(error);
            throw error;
        }
        finally {
            leaveCall?.();
            leaveRunning?.();
            if (token !== undefined)
                promiseReplayContext.getStore()?.completeCallback(token);
        }
    };
    const wrapped = async (...args) => {
        const sandboxArgs = copyHostValueToSandbox([...args], stackFrames, {
            budget,
            hostCalls: callbacks?.journal
        }, { seen: new WeakMap() }, "<callback>");
        const restored = callbacks === undefined ? undefined : callbacks.restored[callbacks.nextInvocation++];
        if (restored !== undefined) {
            if (restored.id !== id ||
                JSON.stringify(encodeReplayData(sandboxArgs, {
                    identifyCapability: callbacks?.journal?.identifyCapability
                })) !== JSON.stringify(restored.arguments)) {
                const error = new HostCallResumabilityError(callbacks.record, "external-reconciliation", "Host callback arguments changed while re-issuing the operation; external reconciliation is required.");
                promiseReplayContext.getStore()?.fail(error);
                throw error;
            }
            return await restored.result;
        }
        const replay = promiseReplayContext.getStore();
        const catchUp = replay?.waitForLiveExecution();
        if (catchUp !== undefined)
            await catchUp;
        const token = callbacks?.record === undefined
            ? undefined
            : callbacks.journal?.recordCallback(callbacks.record, id, sandboxArgs, replay?.currentStep ?? 0);
        if (token !== undefined)
            replay?.beginCallback(token);
        const pending = invoke(sandboxArgs, token);
        callbacks?.active.add(pending);
        void pending.then(() => {
            callbacks?.active.delete(pending);
        }, () => {
            callbacks?.active.delete(pending);
        });
        return pending;
    };
    callbacks?.seen.set(closure, wrapped);
    callbacks?.entries.set(id, invoke);
    callbacks?.hostFunctions.set(id, wrapped);
    callbacks?.sourceFunctions.set(id, closure);
    if (callbacks?.record !== undefined)
        callbacks.journal?.registerCallbackFunction(callbacks.record, id, closure, wrapped);
    return wrapped;
}
function isSandboxLikeValue(value) {
    if (value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
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
function isAsyncFunction(value) {
    return value instanceof AsyncFunction;
}
function isPromiseLike(value) {
    return typeof value === "object" && value !== null && "then" in value;
}
function isFatalBridgeError(error) {
    return (error instanceof HostCallResumabilityError ||
        (error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry")));
}
function wrapHostPromiseWithSignal(promise, signal) {
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
        const settle = (complete) => {
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
        promise.then((value) => {
            settle(() => resolve(value));
        }, (reason) => {
            settle(() => reject(reason));
        });
    });
}
function copyHostValueToSandbox(value, stackFrames, options, state, path) {
    const { budget } = options;
    if (value === null ||
        value === undefined ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return options.budget.allocateString(value);
    }
    if (isSandboxClosure(value) || isSandboxPromise(value)) {
        return deepCopyToSandbox(value);
    }
    if (typeof value === "function") {
        const sourceClosure = options.hostCalls?.nativeClosures.get(value);
        if (sourceClosure !== undefined)
            return sourceClosure;
        const callable = value;
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        return wrapCallerInjectedFunction(callable.name.length > 0 ? callable.name : readPathName(path), callable, {
            ...options,
            operation: path.startsWith("<root>")
                ? `${options.operation ?? "<root>"}${path.slice(6)}`
                : path
        }, state);
    }
    if (isPromiseLike(value)) {
        const promise = wrapHostPromiseWithSignal(Promise.resolve(value), options.signal).then((resolved) => {
            try {
                return copyHostValueToSandbox(resolved, stackFrames, options, {
                    seen: new WeakMap()
                }, "<root>");
            }
            catch (error) {
                if (isFatalBridgeError(error)) {
                    return Promise.reject(error);
                }
                return Promise.reject(createHostErrorValue(error, stackFrames, budget));
            }
        }, (reason) => {
            if (isFatalBridgeError(reason)) {
                return Promise.reject(reason);
            }
            return Promise.reject(createHostErrorValue(reason, stackFrames, budget));
        });
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
        const copy = new Array(value.length);
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
            copy.entries.set(copyHostValueToSandbox(key, stackFrames, options, state, `${path}.<key>`), copyHostValueToSandbox(entry, stackFrames, options, state, `${path}.<value>`));
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
            copy.values.add(copyHostValueToSandbox(entry, stackFrames, options, state, `${path}.<value>`));
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
                throw new TypeError(`Unsupported sandbox value at ${joinPath(path, key)}: accessor property`);
            }
            // Charged like any other string the copy carries in: a key is as readable to the sandbox
            // as the value under it, so the same limit answers for both.
            Object.defineProperty(copy, budget.allocateString(key), {
                enumerable: true,
                configurable: true,
                writable: true,
                value: copyHostValueToSandbox(descriptor.value, stackFrames, options, state, joinPath(path, key))
            });
        }
        return copy;
    }
    throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}
function readAbortReason(signal) {
    return signal.reason ?? createAbortError();
}
function createAbortError() {
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
function describeThrownReason(reason) {
    if (reason === undefined) {
        return "";
    }
    if (typeof reason === "string") {
        return reason;
    }
    if (reason === null ||
        typeof reason === "number" ||
        typeof reason === "boolean" ||
        typeof reason === "bigint" ||
        typeof reason === "symbol") {
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
    }
    catch {
        return Object.prototype.toString.call(reason);
    }
}
function readStringProperty(value, key) {
    if (!Object.hasOwn(value, key)) {
        return undefined;
    }
    const entry = value[key];
    return typeof entry === "string" ? entry : undefined;
}
function copyFunctionProperties(callable, stackFrames, options, state, path) {
    const properties = {};
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
        properties[key] = copyHostValueToSandbox(descriptor.value, stackFrames, options, state, joinPath(path, key));
    }
    return Object.keys(properties).length > 0 ? properties : undefined;
}
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function joinPath(path, key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
        ? `${path}.${key}`
        : `${path}[${JSON.stringify(key)}]`;
}
function readPathName(path) {
    const segment = path.replace(/^.*\./u, "");
    return segment === "<root>" ? "host" : segment;
}
function describeValue(value) {
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
