import type { Budget } from "./budget.js";
import { createSubsetErrorValue } from "./exceptions.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  deepCopyFromSandbox,
  deepCopyToSandbox,
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
        const hostArgs = args.map((arg) => deepCopyFromSandbox(arg));

        return copyHostResultToSandbox(
          Reflect.apply(value, undefined, hostArgs),
          context?.stack ?? [],
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

function isAsyncFunction(value: (...args: readonly unknown[]) => unknown): boolean {
  return value instanceof AsyncFunction;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}
