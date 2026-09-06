import { SandboxError, type Budget } from "./budget.js";
import { accessorClosure } from "./accessors.js";
import { getSandboxPropertyDescriptor } from "./object-model.js";
import { coerceThrownValue, createSubsetErrorValue } from "./exceptions.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult } from "./iteration.js";
import { retainValues } from "./resources.js";
import { runPromiseJob } from "./jobs.js";
import { observeSandboxPromise } from "./promise-tracker.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxObject,
  type SandboxPromise,
  type SandboxValue
} from "./values.js";

export type PromiseGlobals = {
  Promise: SandboxClosure;
};

const promiseConstructors = new WeakSet<SandboxClosure>();
const intrinsicPromiseConstructors = new WeakMap<Budget, SandboxClosure>();
const promisePrototypes = new WeakMap<Budget, SandboxObject>();

export function isSandboxPromiseConstructor(value: unknown): value is SandboxClosure {
  return isSandboxClosure(value) && promiseConstructors.has(value);
}

export function createPromiseGlobals(options: { budget: Budget }): PromiseGlobals {
  promisePrototypes.delete(options.budget);
  const prototype = getPromisePrototype(options.budget);
  const construct: NonNullable<SandboxClosure["construct"]> = async ([executor], context) => {
    if (!isSandboxClosure(executor)) throw new TypeError("Promise executor must be a function.");
    let fulfill!: (value: SandboxValue | PromiseLike<SandboxValue>) => void;
    let reject!: (reason: unknown) => void;
    const pending = createSandboxPromise(
      new Promise<SandboxValue>((resolve, rejectPromise) => {
        fulfill = resolve;
        reject = rejectPromise;
      }),
      { span: context?.span }
    );
    let settled = false;
    const settle = (state: "fulfilled" | "rejected", value: SandboxValue) => {
      if (settled) return;
      settled = true;
      try {
        if (state === "rejected") {
          reject(budgetSandboxValue(value, options.budget));
        } else if (value === pending) {
          reject(
            createSubsetErrorValue(
              "TypeError",
              "Promise cannot resolve to itself.",
              context?.stack ?? [],
              options.budget
            )
          );
        } else {
          fulfill(resolveSandboxValue(value, { budget: options.budget, self: pending }));
        }
      } catch (error) {
        reject(error);
      }
    };
    try {
      const result = executor.call(
        [
          createSandboxClosure({
            sandbox: true,
            name: "resolve",
            retainedValues: () => [pending],
            call: ([value]) => {
              settle("fulfilled", value);
              return undefined;
            }
          }),
          createSandboxClosure({
            sandbox: true,
            name: "reject",
            retainedValues: () => [pending],
            call: ([reason]) => {
              settle("rejected", reason);
              return undefined;
            }
          })
        ],
        { stack: context?.stack ?? [], thisValue: undefined }
      );
      if (executor.async !== true) await result;
      else if (isSandboxPromise(result) && result.synchronousPrefix !== undefined)
        await result.synchronousPrefix;
      else if (isPromiseLike(result)) createSandboxPromise(Promise.resolve(result));
    } catch (error) {
      if (
        error instanceof SandboxError &&
        (error.code === "budgetExceeded" || error.code === "reentry")
      ) {
        observeSandboxPromise(pending);
        throw error;
      }
      settle("rejected", error as SandboxValue);
    }
    return pending;
  };
  const promiseConstructor = createSandboxClosure({
    sandbox: true,
    name: "Promise",
    construct,
    call: () => {
      throw new TypeError("Constructor Promise requires 'new'.");
    },
    properties: {
      prototype,
      all: createSandboxClosure({
        sandbox: true,
        call: ([values], context) =>
          settleIterable(
            values,
            "all",
            options.budget,
            context === undefined ? promiseConstructor : context.thisValue,
            context
          ),
        name: "all"
      }),
      race: createSandboxClosure({
        sandbox: true,
        call: ([values], context) =>
          settleIterable(
            values,
            "race",
            options.budget,
            context === undefined ? promiseConstructor : context.thisValue,
            context
          ),
        name: "race"
      }),
      allSettled: createSandboxClosure({
        sandbox: true,
        call: ([values], context) =>
          settleIterable(
            values,
            "allSettled",
            options.budget,
            context === undefined ? promiseConstructor : context.thisValue,
            context
          ),
        name: "allSettled"
      }),
      any: createSandboxClosure({
        sandbox: true,
        call: ([values], context) =>
          settleIterable(
            values,
            "any",
            options.budget,
            context === undefined ? promiseConstructor : context.thisValue,
            context
          ),
        name: "any"
      }),
      resolve: createSandboxClosure({
        sandbox: true,
        call: ([value], context) => {
          const constructor = context === undefined ? promiseConstructor : context.thisValue;
          if (typeof constructor !== "object" || constructor === null) {
            throw new TypeError("Promise.resolve requires an object receiver.");
          }
          if (
            isSandboxPromise(value) &&
            getPromiseMember("constructor", options.budget) === constructor
          ) {
            return value;
          }
          return isSandboxPromiseConstructor(constructor)
            ? createSandboxPromise(resolveSandboxValue(value, { budget: options.budget }))
            : settleConstructedPromise(constructor, value, "fulfilled", options.budget, context);
        },
        name: "resolve"
      }),
      reject: createSandboxClosure({
        sandbox: true,
        call: ([reason], context) => {
          const constructor = context === undefined ? promiseConstructor : context.thisValue;
          return isSandboxPromiseConstructor(constructor)
            ? createRejectedSandboxPromise(reason, options.budget, context?.span)
            : settleConstructedPromise(constructor, reason, "rejected", options.budget, context);
        },
        name: "reject"
      })
    }
  });
  Object.defineProperty(prototype, "constructor", {
    value: promiseConstructor,
    writable: true,
    configurable: true
  });
  promiseConstructors.add(promiseConstructor);
  intrinsicPromiseConstructors.set(options.budget, promiseConstructor);
  return { Promise: promiseConstructor };
}

export function getPromiseMember(property: string | number, budget: Budget): SandboxValue {
  const prototype = getPromisePrototype(budget);
  return Object.hasOwn(prototype, property) ? prototype[property] : undefined;
}

async function settleConstructedPromise(
  constructor: SandboxValue,
  value: SandboxValue,
  state: "fulfilled" | "rejected",
  budget: Budget,
  context: SandboxCallContext | undefined
): Promise<SandboxValue> {
  const capability = await createPromiseCapability(constructor, budget, context);
  await callPromiseClosure(
    state === "fulfilled" ? capability.resolve : capability.reject,
    [value],
    undefined,
    budget,
    context
  );
  return capability.promise;
}

async function createPromiseCapability(
  constructor: SandboxValue,
  budget: Budget,
  context: SandboxCallContext | undefined
): Promise<{ promise: SandboxValue; resolve: SandboxClosure; reject: SandboxClosure }> {
  if (!isSandboxClosure(constructor) || constructor.construct === undefined) {
    throw new TypeError("Promise method requires a constructor receiver.");
  }
  let resolve: SandboxValue;
  let reject: SandboxValue;
  const executor = createSandboxClosure({
    sandbox: true,
    retainedValues: () => [resolve, reject],
    call: (args) => {
      if (resolve !== undefined || reject !== undefined) {
        throw new TypeError("Promise capability is already initialized.");
      }
      [resolve, reject] = args;
      return undefined;
    }
  });
  const leaveCall = budget.enterCall();
  try {
    const promise = await constructor.construct([executor], {
      stack: context?.stack ?? [],
      thisValue: undefined,
      ...(context?.span === undefined ? {} : { span: context.span })
    });
    if (!isSandboxClosure(resolve) || !isSandboxClosure(reject)) {
      throw new TypeError("Promise capability requires callable resolve and reject functions.");
    }
    return { promise, resolve, reject };
  } finally {
    leaveCall();
  }
}

async function callPromiseClosure(
  callback: SandboxClosure,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  const leaveCall = budget.enterCall();
  try {
    const stack = context?.stack ?? [];
    const values = args.map((value) =>
      value instanceof Error && !(value instanceof SandboxError)
        ? coerceThrownValue(value, budget, stack)
        : value
    );
    let result = callback.call(values, { ...context, stack, thisValue, newTarget: undefined });
    if (callback.async !== true) result = await result;
    else if (isPromiseLike(result)) result = createSandboxPromise(Promise.resolve(result));
    if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
      await result.synchronousPrefix;
    }
    return result;
  } finally {
    leaveCall();
  }
}

function getPromisePrototype(budget: Budget): SandboxObject {
  const existing = promisePrototypes.get(budget);
  if (existing !== undefined) return existing;
  const prototype: SandboxObject = {
    then: createSandboxClosure({
      sandbox: true,
      call: ([onFulfilled, onRejected], context) => {
        const target = context?.thisValue;
        if (!isSandboxPromise(target))
          throw new TypeError("Promise.then requires a promise receiver.");
        validatePromiseConstructorProperty(target, prototype);
        observeSandboxPromise(target);
        const chained = createSandboxPromise(
          target.promise.then(
            (value) => {
              consumeSettledHostCall(target);
              return runPromiseReaction(onFulfilled, value, "fulfilled", budget, chained, context);
            },
            (reason: SandboxValue) => {
              consumeSettledHostCall(target);
              return runPromiseReaction(onRejected, reason, "rejected", budget, chained, context);
            }
          )
        );
        return chained;
      },
      name: "then"
    }),
    catch: createSandboxClosure({
      sandbox: true,
      call: ([onRejected], context) => {
        const target = context?.thisValue;
        const invoke = (then: SandboxValue) => {
          if (!isSandboxClosure(then))
            throw new TypeError("Promise.catch requires a callable then.");
          return then.call([undefined, onRejected], {
            ...context,
            stack: context?.stack ?? [],
            thisValue: target,
            newTarget: undefined
          });
        };
        const then = readPromiseReceiverProperty(target, "then", prototype, context);
        return then instanceof Promise ? then.then(invoke) : invoke(then);
      },
      name: "catch"
    }),
    finally: createSandboxClosure({
      sandbox: true,
      call: ([onFinally], context) => {
        const target = context?.thisValue;
        if (typeof target !== "object" || target === null) {
          throw new TypeError("Promise.finally requires an object receiver.");
        }
        const invoke = (then: SandboxValue) => {
          if (!isSandboxClosure(then))
            throw new TypeError("Promise.finally requires a callable then.");
          const handlers = isSandboxClosure(onFinally)
            ? (["fulfilled", "rejected"] as const).map((state) =>
                createSandboxClosure({
                  sandbox: true,
                  retainedValues: () => [onFinally],
                  call: async ([value]) => {
                    const result = await callPromiseClosure(
                      onFinally,
                      [],
                      undefined,
                      budget,
                      context
                    );
                    const pending =
                      isSandboxPromise(result) &&
                      getPromiseMember("constructor", budget) ===
                        intrinsicPromiseConstructors.get(budget)
                        ? result
                        : createSandboxPromise(resolveSandboxValue(result, { budget }));
                    const cleanupThen = getPromiseMember("then", budget);
                    if (!isSandboxClosure(cleanupThen))
                      throw new TypeError("Promise cleanup requires a callable then.");
                    return callPromiseClosure(
                      cleanupThen,
                      [
                        createSandboxClosure({
                          sandbox: true,
                          retainedValues: () => [value],
                          call: () => {
                            if (state === "rejected") throw value;
                            return value;
                          }
                        })
                      ],
                      pending,
                      budget,
                      context
                    );
                  }
                })
              )
            : [onFinally, onFinally];
          return then.call(handlers, {
            ...context,
            stack: context?.stack ?? [],
            thisValue: target,
            newTarget: undefined
          });
        };
        const finish = () => {
          const then = readPromiseReceiverProperty(target, "then", prototype, context);
          return then instanceof Promise ? then.then(invoke) : invoke(then);
        };
        const validation = validatePromiseConstructorProperty(target, prototype, context);
        return validation instanceof Promise ? validation.then(finish) : finish();
      },
      name: "finally"
    })
  };
  for (const name of Object.keys(prototype)) {
    Object.defineProperty(prototype, name, { enumerable: false });
  }
  promisePrototypes.set(budget, prototype);
  return prototype;
}

function readPromiseReceiverProperty(
  receiver: SandboxValue,
  property: string,
  prototype: SandboxObject,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  if (!isSandboxPromise(receiver) && context?.getProperty !== undefined)
    return context.getProperty(receiver, property);
  const properties = isSandboxPromise(receiver)
    ? prototype
    : isSandboxClosure(receiver)
      ? receiver.properties
      : receiver;
  return typeof properties === "object" &&
    properties !== null &&
    Object.hasOwn(properties, property)
    ? (properties as SandboxObject)[property]
    : undefined;
}

function validatePromiseConstructorProperty(
  receiver: SandboxValue,
  prototype: SandboxObject,
  context?: SandboxCallContext
): void | Promise<void> {
  const validate = (constructor: SandboxValue) => {
    if (constructor !== undefined && (typeof constructor !== "object" || constructor === null))
      throw new TypeError("Promise constructor property must be an object.");
  };
  const constructor = readPromiseReceiverProperty(receiver, "constructor", prototype, context);
  return constructor instanceof Promise ? constructor.then(validate) : validate(constructor);
}

async function settleIterable(
  iterable: SandboxValue,
  method: "all" | "allSettled" | "race" | "any",
  budget: Budget,
  constructor: SandboxValue,
  context: SandboxCallContext | undefined
): Promise<SandboxValue> {
  const capability = await createPromiseCapability(constructor, budget, context);
  const prototype = getPromisePrototype(budget);
  const values: SandboxValue[] = [];
  let remaining = 1;
  const complete = async () => {
    if (remaining !== 0 || method === "race") return;
    if (method === "any") {
      const error = createSubsetErrorValue(
        "AggregateError",
        "All promises were rejected",
        [],
        budget
      );
      error.errors = values;
      await callPromiseClosure(
        capability.reject,
        [budgetSandboxValue(error, budget)],
        undefined,
        budget,
        context
      );
    } else {
      await callPromiseClosure(
        capability.resolve,
        [budgetSandboxValue(values, budget)],
        undefined,
        budget,
        context
      );
    }
  };
  try {
    const promiseResolve = await readPromiseReceiverProperty(constructor, "resolve", prototype, context);
    if (!isSandboxClosure(promiseResolve))
      throw new TypeError("Promise constructor requires a callable resolve.");
    const iterator = context === undefined ? getSandboxIterator(iterable, budget) : await acquireSandboxIterator(iterable, budget, context);
    if (iterator === undefined) throw new TypeError("Promise helpers require an iterable.");
    const releaseIterator = retainValues(budget, () => [iterator.retainedValue]);
    try {
      let index = 0;
      while (true) {
        budget.visitNode();
        const next =
          iterator.generator || iterator.asynchronous
            ? await iterator.next()
            : (iterator.next() as IteratorResult<SandboxValue>);
        if (typeof next !== "object" || next === null)
          throw new TypeError("Iterator result must be an object.");
        if ((await readIteratorResult(iterator, next, "done")).value) break;
        const value = (await readIteratorResult(iterator, next, "value")).value;
        try {
          budget.allocateArrayLength(index + 1);
          const entryIndex = index++;
          if (method !== "race") values.push(undefined);
          const entry = await callPromiseClosure(
            promiseResolve,
            [value],
            constructor,
            budget,
            context
          );
          let called = false;
          const handlers = (["fulfilled", "rejected"] as const).map((state) => {
            if (method === "race" || (method === "any" && state === "fulfilled"))
              return state === "fulfilled" ? capability.resolve : capability.reject;
            if (method === "all" && state === "rejected") return capability.reject;
            return createSandboxClosure({
              sandbox: true,
              retainedValues: () => [
                capability.promise,
                capability.resolve,
                capability.reject,
                values
              ],
              call: async ([settlement]) => {
                if (called) return undefined;
                called = true;
                values[entryIndex] =
                  method === "allSettled"
                    ? state === "fulfilled"
                      ? { status: state, value: settlement }
                      : { status: state, reason: settlement }
                    : settlement;
                remaining--;
                await complete();
                return undefined;
              }
            });
          });
          remaining++;
          const then = await readPromiseReceiverProperty(entry, "then", prototype, context);
          if (!isSandboxClosure(then))
            throw new TypeError("Promise resolver result requires a callable then.");
          await callPromiseClosure(then, handlers, entry, budget, context);
        } catch (error) {
          await closeIterator(iterator, true);
          throw error;
        }
      }
      remaining--;
      await complete();
    } finally {
      releaseIterator();
    }
  } catch (error) {
    if (
      error instanceof SandboxError &&
      (error.code === "budgetExceeded" || error.code === "reentry")
    ) {
      if (isSandboxPromise(capability.promise)) observeSandboxPromise(capability.promise);
      throw error;
    }
    await callPromiseClosure(
      capability.reject,
      [error as SandboxValue],
      undefined,
      budget,
      context
    );
  }
  return capability.promise;
}

function schedulePromise(promise: Promise<SandboxValue>, budget: Budget): Promise<SandboxValue> {
  return Promise.resolve().then(() =>
    promise.then(
      (value) => resolveSandboxValue(value, { budget }),
      (reason: SandboxValue) => Promise.reject(budgetSandboxValue(reason, budget))
    )
  );
}

function createRejectedSandboxPromise(
  reason: SandboxValue,
  budget: Budget,
  span?: SandboxPromise["span"]
): ReturnType<typeof createSandboxPromise> {
  const promise = schedulePromise(Promise.reject(reason), budget);

  // Mark the host promise as handled immediately while preserving its rejected state for sandbox await.
  promise.catch(() => undefined);
  return createSandboxPromise(promise, { span });
}

function budgetSandboxValue(value: SandboxValue, budget: Budget): SandboxValue {
  allocateSandboxValue(value, budget, new WeakSet());
  return value;
}

export function resolveSandboxValue(
  value: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  options: { budget?: Budget; self?: SandboxPromise } = {}
): Promise<SandboxValue> {
  try {
    return resolveSandboxValueNow(value, options);
  } catch (error) {
    return Promise.reject(error);
  }
}

// A host call result is consumed once, when it settles. Observing the same promise
// again is ordinary JavaScript and must not be reported as a double consumption.
export function consumeSettledHostCall(value: SandboxPromise): undefined {
  if (value.hostCall?.lifecycle !== "settled") {
    return;
  }

  value.hostCallJournal?.consume(value.hostCall);
}

function resolveSandboxValueNow(
  value: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  options: { budget?: Budget; self?: SandboxPromise }
): Promise<SandboxValue> {
  if (isPromiseLike(value)) {
    return Promise.resolve(value).then(
      (resolved) => resolveSandboxValueNow(resolved, options),
      (reason: SandboxValue) => Promise.reject(budgetIfNeeded(reason, options.budget))
    );
  }

  if (isSandboxPromise(value)) {
    if (options.budget !== undefined) {
      return resolvePromiseResult(value, options.budget, options.self);
    }
    observeSandboxPromise(value);
    return value.promise.then(
      (resolved) => {
        consumeSettledHostCall(value);
        return resolveSandboxValueNow(resolved, options);
      },
      (reason: SandboxValue) => {
        consumeSettledHostCall(value);
        return Promise.reject(budgetIfNeeded(reason, options.budget));
      }
    );
  }

  const then = getThenable(value, options.budget);
  if (then instanceof Promise)
    return then.then((method) =>
      method === undefined
        ? budgetIfNeeded(value, options.budget)
        : resolveThenable(value, method, options)
    );
  if (then !== undefined) {
    return resolveThenable(value, then, options);
  }

  return Promise.resolve(budgetIfNeeded(value, options.budget));
}

function resolveThenable(
  value: SandboxValue,
  then: SandboxClosure,
  options: { budget?: Budget; self?: SandboxPromise }
): Promise<SandboxValue> {
  if (typeof value !== "object" || value === null) {
    return Promise.resolve(budgetIfNeeded(value, options.budget));
  }

  return new Promise<SandboxValue>((resolve, reject) => {
    let settlement:
      | { state: "fulfilled"; value: SandboxValue }
      | { state: "rejected"; value: SandboxValue }
      | undefined;
    let completed = false;
    let invocationPending = true;
    const complete = () => {
      if (completed || invocationPending || settlement === undefined) return;
      completed = true;
      try {
        if (settlement.state === "fulfilled") {
          resolve(
            requiresPromiseResolution(settlement.value, options.budget)
              ? resolveSandboxValueNow(settlement.value, options)
              : budgetIfNeeded(settlement.value, options.budget)
          );
        } else {
          reject(budgetIfNeeded(settlement.value, options.budget));
        }
      } catch (error) {
        reject(error);
      }
    };
    const recordSettlement = (state: "fulfilled" | "rejected", settledValue: SandboxValue) => {
      if (settlement !== undefined) {
        return;
      }
      settlement = { state, value: settledValue };
      queueMicrotask(complete);
    };
    callInPromiseJob(
      then,
      [
        createSandboxClosure({
          sandbox: true,
          call: ([resolved]) => {
            recordSettlement("fulfilled", resolved);
            return undefined;
          },
          name: "resolve"
        }),
        createSandboxClosure({
          sandbox: true,
          call: ([reason]) => {
            recordSettlement("rejected", reason);
            return undefined;
          },
          name: "reject"
        })
      ],
      value,
      {
        fulfilled: () => {
          invocationPending = false;
          complete();
        },
        rejected: (error: SandboxValue) => {
          invocationPending = false;
          if (
            error instanceof SandboxError &&
            (error.code === "budgetExceeded" || error.code === "reentry")
          ) {
            completed = true;
            reject(error);
            return;
          }
          recordSettlement("rejected", error);
          complete();
        }
      }
    ).catch(reject);
  });
}

function runPromiseReaction(
  handler: SandboxValue,
  value: SandboxValue,
  state: "fulfilled" | "rejected",
  budget: Budget,
  self?: SandboxPromise,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  return new Promise<SandboxValue>((resolve, reject) => {
    if (
      state === "rejected" &&
      value instanceof SandboxError &&
      (value.code === "budgetExceeded" || value.code === "reentry")
    ) {
      reject(value);
      return;
    }
    const argument =
      state === "rejected" && value instanceof Error ? coerceThrownValue(value, budget, []) : value;
    const fulfilled = (result: SandboxValue | Promise<SandboxValue>) => {
      if (isPromiseLike(result)) {
        resolve(resolvePromiseResult(result, budget, self));
      } else if (isSelfResolution(result, self)) {
        reject(
          createSubsetErrorValue("TypeError", "Promise cannot resolve to itself.", [], budget)
        );
      } else if (requiresPromiseResolution(result, budget)) {
        resolve(resolvePromiseResult(result, budget, self));
      } else {
        resolve(budgetSandboxValue(result, budget));
      }
    };
    if (isSandboxClosure(handler)) {
      callInPromiseJob(handler, [argument], undefined, { fulfilled, rejected: reject }, context).catch(
        reject
      );
    } else {
      runPromiseJob(() => {
        if (state === "fulfilled") fulfilled(value);
        else reject(budgetSandboxValue(value, budget));
      }).catch(reject);
    }
  });
}

function callInPromiseJob(
  handler: SandboxClosure,
  args: readonly SandboxValue[],
  thisValue: SandboxValue = undefined,
  completion?: {
    fulfilled: (value: SandboxValue | Promise<SandboxValue>) => void;
    rejected: (reason: SandboxValue) => void;
  },
  context?: SandboxCallContext
): Promise<{ value: SandboxValue | Promise<SandboxValue> }> {
  return runPromiseJob(async () => {
    try {
      let result = handler.call(args, { ...context, stack: [], thisValue, newTarget: undefined });
      if (handler.async !== true) result = await result;
      if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
        await result.synchronousPrefix;
      }
      completion?.fulfilled(result);
      return { value: result };
    } catch (error) {
      if (completion === undefined) throw error;
      completion.rejected(error as SandboxValue);
      return { value: undefined };
    }
  });
}

function resolvePromiseResult(
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  budget: Budget,
  self: SandboxPromise | undefined
): Promise<SandboxValue> {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then((resolved) => resolvePromiseResult(resolved, budget, self));
  }
  if (isSelfResolution(result, self)) {
    return Promise.reject(
      createSubsetErrorValue("TypeError", "Promise cannot resolve to itself.", [], budget)
    );
  }
  if (!isSandboxPromise(result)) return resolveSandboxValue(result, { budget, self });
  const then = getPromiseMember("then", budget);
  if (!isSandboxClosure(then)) return Promise.resolve(result);
  return new Promise<SandboxValue>((resolve, reject) => {
    let settled = false;
    const settle = (state: "fulfilled" | "rejected", value: SandboxValue) => {
      if (settled) return;
      settled = true;
      try {
        if (state === "rejected") reject(budgetSandboxValue(value, budget));
        else if (requiresPromiseResolution(value, budget)) {
          resolve(resolvePromiseResult(value, budget, self));
        } else {
          resolve(budgetSandboxValue(value, budget));
        }
      } catch (error) {
        reject(error);
      }
    };
    runPromiseJob(async () => {
      try {
        const completion = await callPromiseClosure(
          then,
          [
            createSandboxClosure({
              sandbox: true,
              call: ([value]) => {
                settle("fulfilled", value);
                return undefined;
              }
            }),
            createSandboxClosure({
              sandbox: true,
              call: ([reason]) => {
                settle("rejected", reason);
                return undefined;
              }
            })
          ],
          result,
          budget
        );
        if (isSandboxPromise(completion)) {
          completion.promise.catch((reason: unknown) => {
            if (
              reason instanceof SandboxError &&
              (reason.code === "budgetExceeded" || reason.code === "reentry")
            ) {
              reject(reason);
            }
          });
        }
      } catch (error) {
        settle("rejected", error as SandboxValue);
      }
    }).catch(reject);
  });
}

function isSelfResolution(result: SandboxValue, self: SandboxPromise | undefined): boolean {
  return (
    self !== undefined &&
    (result === self || (isSandboxPromise(result) && result.promise === self.promise))
  );
}

export function requiresPromiseResolution(value: SandboxValue, budget?: Budget): boolean {
  if (isSandboxPromise(value)) return true;
  const descriptor = getSandboxPropertyDescriptor(value, "then", budget);
  return (
    descriptor !== undefined && (!("value" in descriptor) || isSandboxClosure(descriptor.value))
  );
}

function getThenable(
  value: SandboxValue,
  budget?: Budget
): SandboxClosure | undefined | Promise<SandboxClosure | undefined> {
  if (typeof value !== "object" || value === null || isSandboxPromise(value)) {
    return undefined;
  }

  const descriptor = getSandboxPropertyDescriptor(value, "then", budget);
  if (descriptor !== undefined && !("value" in descriptor)) {
    const getter = accessorClosure(descriptor.get);
    if (getter === undefined) return undefined;
    const result =
      budget === undefined
        ? getter.call([], { stack: [], thisValue: value })
        : callPromiseClosure(getter, [], value, budget);
    return Promise.resolve(result).then((then) => (isSandboxClosure(then) ? then : undefined));
  }
  const then = descriptor?.value;
  return isSandboxClosure(then) ? then : undefined;
}

function budgetIfNeeded(value: SandboxValue, budget: Budget | undefined): SandboxValue {
  return budget === undefined ? value : budgetSandboxValue(value, budget);
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

  if (
    typeof value !== "object" ||
    value === null ||
    isSandboxClosure(value) ||
    isSandboxPromise(value)
  ) {
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

function isPromiseLike(
  value: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>
): value is PromiseLike<SandboxValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function" &&
    !isSandboxClosure(value) &&
    !isSandboxPromise(value)
  );
}
