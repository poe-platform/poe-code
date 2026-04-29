import { normalizeClosureResult } from "./async.js";
import type { Budget } from "./budget.js";
import { createSubsetErrorValue } from "./exceptions.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

const AsyncFunction = (async () => undefined).constructor;

export type CallerInjectedBinding = SandboxValue | ((...args: readonly unknown[]) => unknown);

export function wrapCallerInjectedBindings(
  bindings: Record<string, CallerInjectedBinding>,
  options: { budget: Budget }
): Record<string, SandboxValue> {
  return Object.fromEntries(
    Object.entries(bindings).map(([name, value]) => [
      name,
      wrapCallerInjectedValue(name, value, options.budget)
    ])
  );
}

function wrapCallerInjectedValue(
  name: string,
  value: CallerInjectedBinding,
  budget: Budget
): SandboxValue {
  if (typeof value !== "function") {
    return deepCopyToSandbox(value);
  }

  const bindingName = name === "default" && value.name.length > 0 ? value.name : name;

  return createSandboxClosure({
    ...(isAsyncFunction(value) ? { async: true as const } : {}),
    call: (args, context) => {
      try {
        const stackFrames = context?.stack ?? [];
        const hostArgs = args.map((arg) =>
          deepCopyFromSandbox(arg, {
            wrapClosure: (closure) => wrapSandboxClosureForHost(closure, stackFrames, budget)
          })
        );

        return copyHostResultToSandbox(
          Reflect.apply(value, undefined, hostArgs),
          stackFrames,
          budget
        );
      } catch (error) {
        throw createHostErrorValue(error, context?.stack ?? [], budget);
      }
    },
    name: bindingName
  });
}

function copyHostResultToSandbox(
  result: unknown,
  stackFrames: readonly string[],
  budget: Budget
): SandboxValue {
  return copyHostValueToSandbox(
    result,
    stackFrames,
    budget,
    {
      seen: new WeakMap()
    },
    "<root>"
  );
}

function createHostErrorValue(
  reason: unknown,
  stackFrames: readonly string[],
  budget: Budget
): SandboxObject {
  if (reason instanceof Error) {
    return createSubsetErrorValue(reason.name, reason.message, stackFrames, budget);
  }

  return createSubsetErrorValue(
    "Error",
    reason === undefined ? "" : String(reason),
    stackFrames,
    budget
  );
}

function wrapSandboxClosureForHost(
  closure: SandboxClosure,
  stackFrames: readonly string[],
  budget: Budget
): (...args: readonly unknown[]) => Promise<unknown> {
  return async (...args) => {
    const leaveCall = budget.enterCall();
    const wrapClosure = (nestedClosure: SandboxClosure) =>
      wrapSandboxClosureForHost(nestedClosure, stackFrames, budget);

    try {
      const sandboxArgs = args.map((arg) => deepCopyToSandbox(arg));
      let result: ReturnType<SandboxClosure["call"]>;
      try {
        result = closure.call(sandboxArgs, {
          stack: stackFrames
        });
      } catch (error) {
        if (isSandboxLikeValue(error)) {
          throw deepCopyFromSandbox(error, {
            wrapClosure
          });
        }

        throw error;
      }

      return await (deepCopyFromSandbox(normalizeClosureResult(result), {
        wrapClosure
      }) as Promise<unknown>);
    } finally {
      leaveCall();
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

function copyHostValueToSandbox(
  value: unknown,
  stackFrames: readonly string[],
  budget: Budget,
  state: {
    seen: WeakMap<object, SandboxValue>;
  },
  path: string
): SandboxValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSandboxClosure(value) ||
    isSandboxPromise(value)
  ) {
    return deepCopyToSandbox(value);
  }

  if (typeof value === "function") {
    const callable = value as (...args: readonly unknown[]) => unknown;
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

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
            budget
          );
        } catch (error) {
          throw createHostErrorValue(error, context?.stack ?? [], budget);
        }
      },
      name: callable.name.length > 0 ? callable.name : readPathName(path)
    });

    state.seen.set(value, wrapped);
    return wrapped;
  }

  if (isPromiseLike(value)) {
    return createSandboxPromise(
      Promise.resolve(value).then(
        (resolved) => {
          try {
            return copyHostValueToSandbox(
              resolved,
              stackFrames,
              budget,
              {
                seen: new WeakMap()
              },
              "<root>"
            );
          } catch (error) {
            return Promise.reject(createHostErrorValue(error, stackFrames, budget));
          }
        },
        (reason) => Promise.reject(createHostErrorValue(reason, stackFrames, budget))
      )
    );
  }

  if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Array(value.length) as SandboxValue[];
    state.seen.set(value, copy);

    value.forEach((entry, index) => {
      copy[index] = copyHostValueToSandbox(entry, stackFrames, budget, state, `${path}[${index}]`);
    });

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

      Object.defineProperty(copy, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: copyHostValueToSandbox(descriptor.value, stackFrames, budget, state, joinPath(path, key))
      });
    }

    return copy;
  }

  throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function joinPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
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
