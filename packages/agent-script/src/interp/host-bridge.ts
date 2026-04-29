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
    name
  });
}

function copyHostResultToSandbox(
  result: unknown,
  stackFrames: readonly string[],
  budget: Budget
): SandboxValue {
  if (!isPromiseLike(result)) {
    return deepCopyToSandbox(result);
  }

  return createSandboxPromise(
    Promise.resolve(result).then(
      (value) => {
        try {
          return deepCopyToSandbox(value);
        } catch (error) {
          return Promise.reject(createHostErrorValue(error, stackFrames, budget));
        }
      },
      (reason) => Promise.reject(createHostErrorValue(reason, stackFrames, budget))
    )
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
