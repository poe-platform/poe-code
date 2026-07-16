import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxArray,
  type SandboxObject,
  type SandboxValue
} from "./values.js";
import { observeSandboxPromise } from "./promise-tracker.js";
import { replaceErrorStack } from "../error/shape.js";

export function wrapCancelableBindings(
  bindings: Record<string, SandboxValue>,
  signal?: AbortSignal
): Record<string, SandboxValue> {
  if (signal === undefined) {
    return bindings;
  }

  return wrapCancelableValue(bindings, signal, new WeakMap()) as Record<string, SandboxValue>;
}

function wrapCancelableValue(
  value: SandboxValue,
  signal: AbortSignal,
  seen: WeakMap<object, SandboxValue>
): SandboxValue {
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
      ...(value.hostCall === undefined ? {} : { hostCall: value.hostCall }),
      ...(value.hostCallJournal === undefined ? {} : { hostCallJournal: value.hostCallJournal }),
      ...(value.span === undefined ? {} : { span: value.span })
    });
    seen.set(value, wrapped);
    return wrapped;
  }

  if (Array.isArray(value)) {
    const wrapped = new Array(value.length) as SandboxArray;
    seen.set(value, wrapped);

    for (let index = 0; index < value.length; index += 1) {
      wrapped[index] = wrapCancelableValue(value[index], signal, seen);
    }

    return wrapped;
  }

  const wrapped = Object.create(Object.getPrototypeOf(value)) as SandboxObject;
  seen.set(value, wrapped);

  for (const [key, entry] of Object.entries(value)) {
    wrapped[key] = wrapCancelableValue(entry, signal, seen);
  }

  return wrapped;
}

function wrapCancelableResult(
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  signal: AbortSignal,
  seen: WeakMap<object, SandboxValue>
): SandboxValue | Promise<SandboxValue> {
  if (!isPromiseLike(result)) {
    return wrapCancelableValue(result, signal, seen);
  }

  return wrapCancelablePromise(result, signal, seen);
}

function wrapCancelablePromise(
  promise: PromiseLike<SandboxValue>,
  signal: AbortSignal,
  seen: WeakMap<object, SandboxValue>
): Promise<SandboxValue> {
  if (signal.aborted) {
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
    const settle = (complete: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      complete();
    };

    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(promise).then(
      (value) => {
        settle(() => resolve(wrapCancelableValue(value, signal, seen)));
      },
      (reason) => {
        settle(() => reject(wrapCancelableUnknown(reason, signal, seen)));
      }
    );
  });
}

function wrapCancelableUnknown(
  value: unknown,
  signal: AbortSignal,
  seen: WeakMap<object, SandboxValue>
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    isSandboxClosure(value) ||
    isSandboxPromise(value) ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null)
  ) {
    return wrapCancelableValue(value as SandboxValue, signal, seen);
  }

  return value;
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

function createRejectedSandboxPromise(reason: unknown): ReturnType<typeof createSandboxPromise> {
  const promise = Promise.reject(reason) as Promise<SandboxValue>;
  promise.catch(() => undefined);
  return createSandboxPromise(promise);
}

function isPromiseLike(value: unknown): value is PromiseLike<SandboxValue> {
  return typeof value === "object" && value !== null && "then" in value;
}
