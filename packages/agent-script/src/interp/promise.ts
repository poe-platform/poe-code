import type { Budget } from "./budget.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxArray,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

export type PromiseGlobals = {
  Promise: SandboxObject;
};

export function createPromiseGlobals(options: { budget: Budget }): PromiseGlobals {
  return {
    Promise: {
      all: createSandboxClosure({
        async: true,
        call: ([values]) => createSandboxPromise(settleIterable(values, (entries) => Promise.all(entries), options.budget)),
        name: "all"
      }),
      race: createSandboxClosure({
        async: true,
        call: ([values]) =>
          createSandboxPromise(settleIterable(values, (entries) => Promise.race(entries), options.budget)),
        name: "race"
      }),
      allSettled: createSandboxClosure({
        async: true,
        call: ([values]) =>
          createSandboxPromise(
            settleIterable(
              values,
              (entries) =>
                Promise.allSettled(entries).then((results) =>
                  budgetSandboxValue(
                    results.map((result) =>
                      result.status === "fulfilled"
                        ? {
                            status: "fulfilled",
                            value: result.value
                          }
                        : {
                            reason: result.reason as SandboxValue,
                            status: "rejected"
                          }
                    ),
                    options.budget
                  )
                ),
              options.budget
            )
          ),
        name: "allSettled"
      }),
      any: createSandboxClosure({
        async: true,
        call: ([values]) =>
          createSandboxPromise(
            settleIterable(
              values,
              (entries) =>
                Promise.any(entries).catch((error: AggregateError) =>
                  Promise.reject(
                    budgetSandboxValue(
                      {
                        errors: Array.isArray(error.errors) ? (error.errors as SandboxValue[]) : [],
                        message: "All promises were rejected",
                        name: "AggregateError"
                      },
                      options.budget
                    )
                  )
                ),
              options.budget
            )
          ),
        name: "any"
      }),
      resolve: createSandboxClosure({
        async: true,
        call: ([value]) =>
          isSandboxPromise(value) ? value : createSandboxPromise(schedulePromise(Promise.resolve(value), options.budget)),
        name: "resolve"
      }),
      reject: createSandboxClosure({
        async: true,
        call: ([reason]) => createRejectedSandboxPromise(reason, options.budget),
        name: "reject"
      })
    }
  };
}

function settleIterable(
  iterable: SandboxValue,
  settle: (values: Promise<SandboxValue>[]) => Promise<SandboxValue>,
  budget: Budget
): Promise<SandboxValue> {
  return Promise.resolve().then(() => settle(toHostPromiseArray(iterable)).then((value) => budgetSandboxValue(value, budget)));
}

function toHostPromiseArray(iterable: SandboxValue): Promise<SandboxValue>[] {
  if (Array.isArray(iterable)) {
    return iterable.map((value) => toHostPromise(value));
  }

  if (typeof iterable === "string") {
    return Array.from(iterable, (value) => Promise.resolve(value));
  }

  throw new TypeError("Promise helpers require an array or string iterable.");
}

function toHostPromise(value: SandboxValue): Promise<SandboxValue> {
  return isSandboxPromise(value) ? value.promise : Promise.resolve(value);
}

function schedulePromise(promise: Promise<SandboxValue>, budget: Budget): Promise<SandboxValue> {
  return Promise.resolve().then(() =>
    promise.then(
      (value) => budgetSandboxValue(value, budget),
      (reason: SandboxValue) => Promise.reject(budgetSandboxValue(reason, budget))
    )
  );
}

function createRejectedSandboxPromise(
  reason: SandboxValue,
  budget: Budget
): ReturnType<typeof createSandboxPromise> {
  const promise = schedulePromise(Promise.reject(reason), budget);

  // Mark the host promise as handled immediately while preserving its rejected state for sandbox await.
  promise.catch(() => undefined);
  return createSandboxPromise(promise);
}

function budgetSandboxValue(value: SandboxValue, budget: Budget): SandboxValue {
  allocateSandboxValue(value, budget, new WeakSet());
  return value;
}

function allocateSandboxValue(value: SandboxValue, budget: Budget, seen: WeakSet<object>): void {
  if (typeof value === "string") {
    budget.allocateString(value);
    return;
  }

  if (Array.isArray(value)) {
    budget.allocateArrayLength(value.length);

    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    for (const entry of value) {
      allocateSandboxValue(entry, budget, seen);
    }

    return;
  }

  if (typeof value !== "object" || value === null || isSandboxClosure(value) || isSandboxPromise(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const entry of Object.values(value)) {
    allocateSandboxValue(entry, budget, seen);
  }
}
