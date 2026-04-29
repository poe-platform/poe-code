import { SandboxError } from "./budget.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxArray,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

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
        throwIfAborted(signal);
        return wrapCancelableResult(value.call(args, context), signal, seen);
      },
      name: value.name
    });
    seen.set(value, wrapped);
    return wrapped;
  }

  if (isSandboxPromise(value)) {
    const wrapped = createSandboxPromise(wrapCancelablePromise(value.promise, signal, seen));
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
    return Promise.reject(createAbortSandboxError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortSandboxError());
    };

    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(wrapCancelableValue(value, signal, seen));
      },
      (reason) => {
        signal.removeEventListener("abort", onAbort);
        reject(wrapCancelableUnknown(reason, signal, seen));
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

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw createAbortSandboxError();
}

function createAbortSandboxError(): SandboxError {
  return new SandboxError("aborted");
}

function isPromiseLike(value: unknown): value is PromiseLike<SandboxValue> {
  return typeof value === "object" && value !== null && "then" in value;
}
