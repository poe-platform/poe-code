import { createSandboxClosure, createSandboxPromise, isSandboxClosure, isSandboxPromise } from "./values.js";
import { observeSandboxPromise } from "./promise-tracker.js";
import { replaceErrorStack } from "../error/shape.js";
import { resolveSandboxValue } from "./promise.js";
const cancellationSignals = new WeakMap();
export function wrapCancelableBindings(bindings, signal) {
    if (signal === undefined) {
        return bindings;
    }
    return wrapCancelableValue(bindings, signal, new WeakMap());
}
function wrapCancelableValue(value, signal, seen) {
    if (typeof value !== "object" || value === null) {
        return value;
    }
    const existing = seen.get(value);
    if (existing !== undefined) {
        return existing;
    }
    if (isSandboxClosure(value)) {
        const wrapped = createSandboxClosure({
            ...(value.async === true ? { async: true } : {}),
            call: (args, context) => {
                if (signal.aborted) {
                    if (value.async === true) {
                        return createRejectedSandboxPromise(readAbortReason(signal));
                    }
                    throw readAbortReason(signal);
                }
                return wrapCancelableResult(value.call(args, context), signal, seen);
            },
            name: value.name
        });
        seen.set(value, wrapped);
        return wrapped;
    }
    if (isSandboxPromise(value)) {
        // The wrapper delivers this promise's rejection to the sandbox in its place, so
        // the sandbox never awaits the original and it would otherwise read as unhandled.
        observeSandboxPromise(value);
        const wrapped = createSandboxPromise(wrapCancelablePromise(value.promise, signal, seen), {
            trackReplay: false,
            ...(value.synchronousPrefix === undefined
                ? {}
                : { synchronousPrefix: value.synchronousPrefix }),
            ...(value.hostCall === undefined ? {} : { hostCall: value.hostCall }),
            ...(value.hostCallJournal === undefined ? {} : { hostCallJournal: value.hostCallJournal }),
            ...(value.span === undefined ? {} : { span: value.span })
        });
        seen.set(value, wrapped);
        cancellationSignals.set(wrapped, signal);
        return wrapped;
    }
    if (Array.isArray(value)) {
        const wrapped = new Array(value.length);
        seen.set(value, wrapped);
        for (let index = 0; index < value.length; index += 1) {
            wrapped[index] = wrapCancelableValue(value[index], signal, seen);
        }
        return wrapped;
    }
    const wrapped = Object.create(Object.getPrototypeOf(value));
    seen.set(value, wrapped);
    for (const [key, entry] of Object.entries(value)) {
        wrapped[key] = wrapCancelableValue(entry, signal, seen);
    }
    return wrapped;
}
function wrapCancelableResult(result, signal, seen) {
    if (!isPromiseLike(result)) {
        return wrapCancelableValue(result, signal, seen);
    }
    return wrapCancelablePromise(result, signal, seen);
}
function wrapCancelablePromise(promise, signal, seen) {
    return awaitWithSignal(promise, signal).then((value) => wrapCancelableValue(value, signal, seen), (reason) => {
        if (signal.aborted && reason === signal.reason)
            throw reason;
        throw wrapCancelableUnknown(reason, signal, seen);
    });
}
export function awaitSandboxValue(value, signal) {
    const resolved = resolveSandboxValue(value);
    return isSandboxPromise(value) &&
        (value.synchronousPrefix !== undefined || cancellationSignals.get(value) === signal)
        ? resolved
        : awaitWithSignal(resolved, signal);
}
function awaitWithSignal(promise, signal) {
    if (signal === undefined)
        return Promise.resolve(promise);
    if (signal.aborted) {
        void Promise.resolve(promise).catch(() => undefined);
        return Promise.reject(readAbortReason(signal));
    }
    return new Promise((resolve, reject) => {
        let listenerActive = true;
        let settled = false;
        const onAbort = () => {
            cleanup();
            queueMicrotask(() => {
                settle(() => reject(readAbortReason(signal)));
            });
        };
        const cleanup = () => {
            if (!listenerActive) {
                return;
            }
            listenerActive = false;
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
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(promise).then((value) => {
            settle(() => resolve(value));
        }, (reason) => {
            settle(() => reject(reason));
        });
    });
}
function wrapCancelableUnknown(value, signal, seen) {
    if (value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return value;
    }
    if (isSandboxClosure(value) ||
        isSandboxPromise(value) ||
        Array.isArray(value) ||
        (typeof value === "object" && value !== null)) {
        return wrapCancelableValue(value, signal, seen);
    }
    return value;
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
function createRejectedSandboxPromise(reason) {
    const promise = Promise.reject(reason);
    promise.catch(() => undefined);
    return createSandboxPromise(promise);
}
function isPromiseLike(value) {
    return typeof value === "object" && value !== null && "then" in value;
}
