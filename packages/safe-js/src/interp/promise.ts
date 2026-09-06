import { SandboxError, type Budget } from "./budget.js";
import { accessorAdapter, accessorClosure, readPropertyDescriptor } from "./accessors.js";
import { getSandboxPropertyDescriptor, installPromisePrototype, materializeFunctionProperties, registerIntrinsicFunction } from "./object-model.js";
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
const intrinsicPromiseThenMethods = new WeakSet<SandboxClosure>();
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
  const species = createSandboxClosure({
    guest: true, sandbox: true, name: "get [Symbol.species]", length: 0,
    call: (_args, context) => context?.thisValue
  });
  const properties: SandboxObject = {
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
        guest: true, name: "all", length: 1
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
        guest: true, name: "race", length: 1
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
        guest: true, name: "allSettled", length: 1
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
        guest: true, name: "any", length: 1
      }),
      resolve: createSandboxClosure({
        sandbox: true,
        call: ([value], context) => {
          const constructor = context === undefined ? promiseConstructor : context.thisValue;
          if (typeof constructor !== "object" || constructor === null) {
            throw new TypeError("Promise.resolve requires an object receiver.");
          }
          const finish = (actualConstructor: SandboxValue) => {
            if (isSandboxPromise(value) && actualConstructor === constructor) return value;
            return isSandboxPromiseConstructor(constructor)
              ? createSandboxPromise(resolveSandboxValue(value, { budget: options.budget }))
              : settleConstructedPromise(constructor, value, "fulfilled", options.budget, context);
          };
          if (!isSandboxPromise(value)) return finish(undefined);
          const descriptor = getSandboxPropertyDescriptor(value, "constructor", options.budget);
          const actualConstructor = descriptor === undefined
            ? getPromiseMember("constructor", options.budget)
            : readPropertyDescriptor(descriptor, value, context, true);
          return actualConstructor instanceof Promise
            ? actualConstructor.then(finish) : finish(actualConstructor);
        },
        guest: true, name: "resolve", length: 1
      }),
      reject: createSandboxClosure({
        sandbox: true,
        call: ([reason], context) => {
          const constructor = context === undefined ? promiseConstructor : context.thisValue;
          return isSandboxPromiseConstructor(constructor)
            ? createRejectedSandboxPromise(reason, options.budget, context?.span)
            : settleConstructedPromise(constructor, reason, "rejected", options.budget, context);
        },
        guest: true, name: "reject", length: 1
      })
  };
  const promiseConstructor = createSandboxClosure({
    guest: true, sandbox: true, name: "Promise", length: 1, construct,
    call: () => { throw new TypeError("Constructor Promise requires 'new'."); }
  });
  const constructorProperties = materializeFunctionProperties(promiseConstructor);
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(constructorProperties, key, {
      value, writable: key !== "prototype", configurable: key !== "prototype"
    });
  }
  Object.defineProperty(constructorProperties, Symbol.species, {
    get: accessorAdapter(species, "get"), configurable: true
  });
  Object.defineProperty(prototype, "constructor", {
    value: promiseConstructor,
    writable: true,
    configurable: true
  });
  promiseConstructors.add(promiseConstructor);
  intrinsicPromiseConstructors.set(options.budget, promiseConstructor);
  registerIntrinsicFunction(options.budget, species);
  registerIntrinsicFunction(options.budget, promiseConstructor);
  installPromisePrototype(options.budget, prototype, promiseConstructor);
  for (const method of [
    ...Object.values(properties),
    ...Object.values(Object.getOwnPropertyDescriptors(prototype)).map(descriptor => descriptor.value)
  ]) {
    if (isSandboxClosure(method)) registerIntrinsicFunction(options.budget, method);
  }
  return { Promise: promiseConstructor };
}

export function getPromiseMember(property: string | number, budget: Budget): SandboxValue {
  if (!intrinsicPromiseConstructors.has(budget)) createPromiseGlobals({ budget });
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
        const finish = (constructor: SandboxClosure) => {
          if (!isSandboxPromiseConstructor(constructor)) {
            return createPromiseCapability(constructor, budget, context).then(capability => {
              observeSandboxPromise(target);
              createSandboxPromise(target.promise.then(
                value => {
                  consumeSettledHostCall(target);
                  return runCapabilityReaction(onFulfilled, value, "fulfilled", capability, budget, context);
                },
                (reason: SandboxValue) => {
                  consumeSettledHostCall(target);
                  return runCapabilityReaction(onRejected, reason, "rejected", capability, budget, context);
                }
              ));
              return capability.promise;
            });
          }
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
        };
        const constructor = getPromiseSpeciesConstructor(target, prototype, budget, context);
        return constructor instanceof Promise ? constructor.then(finish) : finish(constructor);
      },
      guest: true, name: "then", length: 2
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
        const descriptor = getSandboxPropertyDescriptor(target, "then", budget);
        const then = descriptor === undefined
          ? readPromiseReceiverProperty(target, "then", prototype, context)
          : readPropertyDescriptor(descriptor, target, context, true);
        return then instanceof Promise ? then.then(invoke) : invoke(then);
      },
      guest: true, name: "catch", length: 1
    }),
    finally: createSandboxClosure({
      sandbox: true,
      call: ([onFinally], context) => {
        const target = context?.thisValue;
        if (typeof target !== "object" || target === null) {
          throw new TypeError("Promise.finally requires an object receiver.");
        }
        const invoke = (then: SandboxValue, constructor: SandboxClosure) => {
          if (!isSandboxClosure(then))
            throw new TypeError("Promise.finally requires a callable then.");
          const handlers = isSandboxClosure(onFinally)
            ? (["fulfilled", "rejected"] as const).map((state) =>
                createSandboxClosure({
                  sandbox: true,
                  retainedValues: () => [onFinally, constructor],
                  call: async ([value]) => {
                    const result = await callPromiseClosure(
                      onFinally,
                      [],
                      undefined,
                      budget,
                      context
                    );
                    let pending: SandboxValue;
                    const actualConstructor = isSandboxPromise(result)
                      ? await readPromiseProperty(result, "constructor", prototype, budget, context)
                      : undefined;
                    if (isSandboxPromise(result) && actualConstructor === constructor) {
                      pending = result;
                    } else if (isSandboxPromiseConstructor(constructor)) {
                      pending = createSandboxPromise(resolveSandboxValue(result, { budget }));
                    } else {
                      pending = await settleConstructedPromise(constructor, result, "fulfilled", budget, context);
                    }
                    const cleanupThen = await readPromiseProperty(pending, "then", prototype, budget, context);
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
        const finish = (constructor: SandboxClosure) => {
          const descriptor = getSandboxPropertyDescriptor(target, "then", budget);
          const then = descriptor === undefined
            ? readPromiseReceiverProperty(target, "then", prototype, context)
            : readPropertyDescriptor(descriptor, target, context, true);
          return then instanceof Promise ? then.then(method => invoke(method, constructor)) : invoke(then, constructor);
        };
        const constructor = getPromiseSpeciesConstructor(target, prototype, budget, context);
        return constructor instanceof Promise ? constructor.then(finish) : finish(constructor);
      },
      guest: true, name: "finally", length: 1
    })
  };
  intrinsicPromiseThenMethods.add(prototype.then as SandboxClosure);
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

function getPromiseSpeciesConstructor(
  receiver: SandboxValue,
  prototype: SandboxObject,
  budget: Budget,
  context?: SandboxCallContext
): SandboxClosure | Promise<SandboxClosure> {
  const defaultConstructor = intrinsicPromiseConstructors.get(budget)!;
  const validate = (constructor: SandboxValue): SandboxClosure | Promise<SandboxClosure> => {
    if (constructor === undefined) return defaultConstructor;
    if (typeof constructor !== "object" || constructor === null)
      throw new TypeError("Promise constructor property must be an object.");
    const finish = (species: SandboxValue): SandboxClosure => {
      if (species === undefined || species === null) return defaultConstructor;
      if (!isSandboxClosure(species) || species.construct === undefined)
        throw new TypeError("Promise species must be a constructor.");
      return species;
    };
    const species = readPromiseProperty(constructor, Symbol.species, prototype, budget, context);
    return species instanceof Promise ? species.then(finish) : finish(species);
  };
  const constructor = readPromiseProperty(receiver, "constructor", prototype, budget, context);
  return constructor instanceof Promise ? constructor.then(validate) : validate(constructor);
}

function readPromiseProperty(
  receiver: SandboxValue,
  property: string | symbol,
  prototype: SandboxObject,
  budget: Budget,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  const descriptor = getSandboxPropertyDescriptor(receiver, property, budget);
  if (descriptor !== undefined && !("value" in descriptor) && context?.invokeClosure === undefined) {
    const getter = accessorClosure(descriptor.get);
    return getter?.call([], { ...context, stack: context?.stack ?? [], thisValue: receiver });
  }
  return descriptor === undefined
    ? typeof property === "string" ? readPromiseReceiverProperty(receiver, property, prototype, context) : undefined
    : readPropertyDescriptor(descriptor, receiver, context, true);
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

  if (isSelfResolution(value, options.self)) {
    return Promise.reject(
      options.budget === undefined
        ? new TypeError("Promise cannot resolve to itself.")
        : createSubsetErrorValue("TypeError", "Promise cannot resolve to itself.", [], options.budget)
    );
  }

  if (
    isSandboxPromise(value) &&
    !hasCustomPromiseThen(value, options.budget)
  ) {
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

function runCapabilityReaction(
  handler: SandboxValue,
  value: SandboxValue,
  state: "fulfilled" | "rejected",
  capability: { resolve: SandboxClosure; reject: SandboxClosure },
  budget: Budget,
  context?: SandboxCallContext
): Promise<undefined> {
  return runPromiseJob(async () => {
    if (value instanceof SandboxError && (value.code === "budgetExceeded" || value.code === "reentry")) {
      throw value;
    }
    let completion = state;
    let result = state === "rejected" && value instanceof Error
      ? coerceThrownValue(value, budget, []) : value;
    if (isSandboxClosure(handler)) {
      try {
        result = await callPromiseClosure(handler, [result], undefined, budget, context);
        completion = "fulfilled";
      } catch (error) {
        if (error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry")) {
          throw error;
        }
        completion = "rejected";
        result = error as SandboxValue;
      }
    }
    await callPromiseClosure(
      completion === "fulfilled" ? capability.resolve : capability.reject,
      [result], undefined, budget, context
    );
    return undefined;
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
  if (!isSandboxPromise(result) || hasCustomPromiseThen(result, budget)) {
    return resolveSandboxValue(result, { budget, self });
  }
  const then = getSandboxPropertyDescriptor(result, "then", budget)?.value ?? getPromiseMember("then", budget);
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

function hasCustomPromiseThen(value: SandboxValue, budget?: Budget): boolean {
  const descriptor = getSandboxPropertyDescriptor(value, "then", budget);
  return descriptor !== undefined &&
    (!isSandboxClosure(descriptor.value) || !intrinsicPromiseThenMethods.has(descriptor.value));
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
  if (typeof value !== "object" || value === null) {
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
