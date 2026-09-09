import { SandboxError, Budget } from "./budget.js";
import { guestProxyStates } from "./guest-proxy.js";
import { callGuestProxy } from "./guest-proxy-call.js";
import { constructGuestProxy } from "./guest-proxy-construct.js";
import { sandboxGetProperty } from "./guest-proxy-get.js";
import { asyncFunctionHandlers } from "./async-function-driver.js";
import { asyncGeneratorHandlers, rejectGeneratorQueue } from "./async-generator-driver.js";
import { accessorAdapter, accessorClosure, readPropertyDescriptor } from "./accessors.js";
import { createIntrinsicObject, getSandboxDataProperty, getSandboxPropertyDescriptor, hasExplicitSandboxPrototype, installPromisePrototype, materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "./object-model.js";
import { coerceThrownValue, createSubsetErrorValue, isSourceReferenceError } from "./exceptions.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult } from "./iteration.js";
import { retainValues } from "./resources.js";
import { runPromiseJob } from "./jobs.js";
import { observeSandboxPromise, unrepresentedPromiseContinuations } from "./promise-tracker.js";
import { promiseResolvingFunctions, promiseResolverActions } from "./promise-resolvers.js";
import { promiseContinuations, promiseReactionResults, linkPromiseAggregateProducer } from "./promise-continuations.js";
import { promiseCapabilityExecutors, type PromiseCapabilityExecutorState } from "./promise-continuations.js";
import { thenableContinuations, thenableResolvers, thenableStates, type ThenableContinuation } from "./promise-continuations.js";
import { trackPromiseContinuation, promiseAdoptions, promiseAdoptionBridges, promiseAdoptionResolvers, promiseAggregateHandlers, promiseAggregateStates, promiseAggregateEntries, type PromiseAggregateState, type PromiseAggregateEntry, type PromiseAdoptionBridge, type PromiseContinuation } from "./promise-continuations.js";
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

type PromiseResolutionOptions = {
  budget?: Budget;
  self?: SandboxPromise;
  context?: SandboxCallContext;
  onSynchronousPrefix?: (prefix: Promise<undefined>) => void;
};

const promiseConstructors = new WeakSet<SandboxClosure>();
const intrinsicPromiseThenMethods = new WeakSet<SandboxClosure>();
const intrinsicPromiseConstructors = new WeakMap<Budget, SandboxClosure>();
const promisePrototypes = new WeakMap<Budget, SandboxObject>();
export const pendingPromiseRejectors = new WeakMap<SandboxPromise, (reason: unknown) => void>();
export const pendingPromiseFulfillers = new WeakMap<SandboxPromise, (value: SandboxValue) => void>();

export function isSandboxPromiseConstructor(value: unknown): value is SandboxClosure {
  return isSandboxClosure(value) && promiseConstructors.has(value);
}

export function isPromiseResolvingFunction(value: unknown): value is SandboxClosure {
  return isSandboxClosure(value) && promiseResolvingFunctions.has(value);
}

export function createPendingPromiseCapability(budget: Budget, context?: SandboxCallContext, synchronousPrefix?: Promise<void>): {
  promise: SandboxPromise; resolve: SandboxClosure; reject: SandboxClosure;
  fulfill: (value: SandboxValue | PromiseLike<SandboxValue>) => void; rejectNative: (reason: unknown) => void
} {
  let fulfill!: (value: SandboxValue | PromiseLike<SandboxValue>) => void;
  let reject!: (reason: unknown) => void;
  const promise = createSandboxPromise(new Promise<SandboxValue>((resolve, rejectPromise) => {
    fulfill = resolve;
    reject = rejectPromise;
  }), {span: context?.span, synchronousPrefix});
  pendingPromiseRejectors.set(promise, reject);
  pendingPromiseFulfillers.set(promise, fulfill);
  const resolverState = {promise, settled: false};
  const continuation: Extract<PromiseContinuation, {kind: "capability"}> = {kind: "capability", state: resolverState};
  trackPromiseContinuation(promise, continuation);
  const resolvers = (["fulfilled", "rejected"] as const).map(status => {
    const resolver = createSandboxClosure({
      sandbox: true, guest: true, name: "", length: 1,
      retainedValues: () => [promise],
      call: ([value]) => {
        if (resolverState.settled) return undefined;
        resolverState.settled = true;
        continuation.resolution = {status, value};
        let prefix: Promise<undefined> | undefined;
        try {
          if (status === "rejected") reject(budgetSandboxValue(value, budget));
          else if (value === promise)
            reject(createSubsetErrorValue("TypeError", "Promise cannot resolve to itself.", context?.stack ?? [], budget));
          else fulfill(resolveSandboxValue(value, {budget, self: promise, context,
            onSynchronousPrefix: pending => { prefix = pending; }}));
        } catch (error) {
          reject(error);
        }
        return prefix;
      }
    });
    promiseResolvingFunctions.set(resolver, resolverState);
    promiseResolverActions.set(resolver, status);
    return resolver;
  });
  return {promise, resolve: resolvers[0], reject: resolvers[1], fulfill, rejectNative: reject};
}

export function attachPendingPromiseReaction(
  source: SandboxPromise,
  capability: ReturnType<typeof createPendingPromiseCapability>,
  onFulfilled: SandboxValue,
  onRejected: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext,
  reactionCapability?: Extract<PromiseContinuation, {kind: "reaction"}>["capability"]
): void {
  const continuation: Extract<PromiseContinuation, {kind: "reaction"}> = {
    kind: "reaction", phase: "waiting", source, onFulfilled, onRejected,
    ...(reactionCapability === undefined ? {} : {capability: reactionCapability})
  };
  observeSandboxPromise(source, true);
  const react = (handler: SandboxValue, value: SandboxValue, status: "fulfilled" | "rejected") => {
    continuation.phase = "running";
    try {
      consumeSettledHostCall(source);
      const asyncContinuation = isSandboxClosure(handler) ? asyncFunctionHandlers.get(handler) : undefined;
      if (isSandboxClosure(handler) && asyncContinuation?.driver.generator?.state === "done") {
        capability.fulfill(handler.call([value], context));
        return;
      }
      capability.fulfill(reactionCapability === undefined
        ? runPromiseReaction(handler, value, status, budget, capability.promise, context)
        : runCapabilityReaction(handler, value, status, reactionCapability, budget, context));
    } catch (error) {
      capability.rejectNative(error);
    }
  };
  source.promise.then(value => react(onFulfilled, value, "fulfilled"), reason => react(onRejected, reason, "rejected"));
  trackPromiseContinuation(capability.promise, continuation);
  const asyncHandler = isSandboxClosure(onRejected) ? asyncFunctionHandlers.get(onRejected) : undefined;
  const generatorHandler = isSandboxClosure(onRejected) ? asyncGeneratorHandlers.get(onRejected) : undefined;
  if (generatorHandler !== undefined) {
    observeSandboxPromise(capability.promise, true);
    void capability.promise.promise.catch(error => rejectGeneratorQueue(generatorHandler.driver, error));
  }
  if (asyncHandler !== undefined) {
    // Infrastructure failures can reject the reaction before either guest
    // handler runs. The enclosing async result must not remain pending.
    observeSandboxPromise(capability.promise, true);
    void capability.promise.promise.catch(error => {
      asyncHandler.driver.phase = "done";
      const reject = pendingPromiseRejectors.get(asyncHandler.driver.capability.promise);
      if (reject === undefined) throw new TypeError("Missing async function rejection capability.");
      reject(error);
    });
  }
}

export function createPromiseGlobals(options: { budget: Budget }): PromiseGlobals {
  promisePrototypes.delete(options.budget);
  const prototype = getPromisePrototype(options.budget);
  const construct: NonNullable<SandboxClosure["construct"]> = async ([executor], context) => {
    if (!isSandboxClosure(executor)) throw new TypeError("Promise executor must be a function.");
    const prototypeValue = context?.newTarget === undefined ? prototype
      : context.getProperty === undefined
        ? getSandboxDataProperty(context.newTarget, "prototype", options.budget)
        : context.getProperty(context.newTarget, "prototype");
    const targetPrototype = prototypeValue instanceof Promise ? await prototypeValue : prototypeValue;
    const capability = createPendingPromiseCapability(options.budget, context);
    const pending = capability.promise;
    if (typeof targetPrototype === "object" && targetPrototype !== null && targetPrototype !== prototype)
      setSandboxPrototype(pending, targetPrototype, options.budget);
    try {
      const resolvers = [capability.resolve, capability.reject];
      const result = guestProxyStates.has(executor)
        ? callGuestProxy(executor, resolvers, options.budget, context, undefined)
        : executor.call(resolvers, { stack: context?.stack ?? [], thisValue: undefined });
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
      capability.reject.call([isSourceReferenceError(error)
        ? coerceThrownValue(error, options.budget, context?.stack ?? [])
        : error as SandboxValue]);
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
            if (isSandboxPromiseConstructor(constructor)) {
              const capability = createPendingPromiseCapability(options.budget, context);
              const prefix = capability.resolve.call([value], context);
              return prefix instanceof Promise ? prefix.then(() => capability.promise) : capability.promise;
            }
            return settleConstructedPromise(constructor, value, "fulfilled", options.budget, context);
          };
          if (!isSandboxPromise(value)) return finish(undefined);
          const descriptor = getSandboxPropertyDescriptor(value, "constructor", options.budget);
          const actualConstructor = descriptor === undefined
            ? hasExplicitSandboxPrototype(value) ? undefined : getPromiseMember("constructor", options.budget)
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
      }),
      try: createSandboxClosure({
        sandbox: true, guest: true, name: "try", length: 1,
        call: async ([callback, ...args], context) => {
          const capability = await createPromiseCapability(
            context === undefined ? promiseConstructor : context.thisValue, options.budget, context
          );
          let result: SandboxValue;
          let rejected = false;
          try {
            if (!isSandboxClosure(callback)) throw new TypeError("Promise.try callback must be callable.");
            result = await callPromiseClosure(callback, args, undefined, options.budget, context);
          } catch (error) {
            if (error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry")) throw error;
            rejected = true;
            result = error as SandboxValue;
          }
          await callPromiseClosure(
            rejected ? capability.reject : capability.resolve, [result], undefined, options.budget, context
          );
          return capability.promise;
        }
      }),
      withResolvers: createSandboxClosure({
        sandbox: true,
        guest: true,
        name: "withResolvers",
        length: 0,
        call: (_args, context) => createPromiseCapability(
          context === undefined ? promiseConstructor : context.thisValue,
          options.budget,
          context
        )
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
  const state: PromiseCapabilityExecutorState = {resolve: undefined, reject: undefined};
  const executor = createPromiseCapabilityExecutor(state);
  const leaveCall = budget.enterCall();
  try {
    const promise = await (guestProxyStates.has(constructor)
      ? constructGuestProxy(constructor, [executor], budget, context, constructor)
      : constructor.construct([executor], {
      ...context,
      stack: context?.stack ?? [],
      thisValue: undefined,
      newTarget: constructor
    }));
    const {resolve, reject} = state;
    if (!isSandboxClosure(resolve) || !isSandboxClosure(reject)) {
      throw new TypeError("Promise capability requires callable resolve and reject functions.");
    }
    return { promise, resolve, reject };
  } finally {
    leaveCall();
  }
}

export function createPromiseCapabilityExecutor(state: PromiseCapabilityExecutorState): SandboxClosure {
  const executor = createSandboxClosure({
    sandbox: true, guest: true, name: "", length: 2,
    retainedValues: () => [state.resolve, state.reject],
    call: ([resolve, reject]) => {
      if (state.resolve !== undefined || state.reject !== undefined)
        throw new TypeError("Promise capability is already initialized.");
      state.resolve = resolve;
      state.reject = reject;
      return undefined;
    }
  });
  promiseCapabilityExecutors.set(executor, state);
  return executor;
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
      (value instanceof Error && !(value instanceof SandboxError)) || isSourceReferenceError(value)
        ? coerceThrownValue(value, budget, stack)
        : value
    );
    let result = guestProxyStates.has(callback)
      ? callGuestProxy(callback, values, budget, context, thisValue)
      : callback.call(values, { ...context, stack, thisValue, newTarget: undefined });
    if (callback.async !== true) result = await result;
    else if (isPromiseLike(result)) result = createSandboxPromise(Promise.resolve(result));
    if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
      await result.synchronousPrefix;
    }
    return result;
  } catch (error) {
    if (isSourceReferenceError(error)) throw coerceThrownValue(error, budget, context?.stack ?? []);
    throw error;
  } finally {
    leaveCall();
  }
}

function getPromisePrototype(budget: Budget): SandboxObject {
  const existing = promisePrototypes.get(budget);
  if (existing !== undefined) return existing;
  const prototype = createIntrinsicObject({
    then: createSandboxClosure({
      sandbox: true,
      call: ([onFulfilled, onRejected], context) => {
        const target = context?.thisValue;
        if (!isSandboxPromise(target))
          throw new TypeError("Promise.then requires a promise receiver.");
        const finish = (constructor: SandboxClosure) => {
          if (!isSandboxPromiseConstructor(constructor)) {
            return createPromiseCapability(constructor, budget, context).then(capability => {
              observeSandboxPromise(target, isSandboxPromise(capability.promise));
              const continuation: Extract<PromiseContinuation, {kind: "reaction"}> | undefined = isSandboxPromise(capability.promise)
                ? {kind: "reaction", phase: "waiting", source: target, onFulfilled, onRejected,
                    capability: {...capability, promise: capability.promise}}
                : undefined;
              const completion = createSandboxPromise(target.promise.then(
                value => {
                  if (continuation !== undefined) continuation.phase = "running";
                  consumeSettledHostCall(target);
                  return runCapabilityReaction(onFulfilled, value, "fulfilled", capability, budget, context);
                },
                (reason: SandboxValue) => {
                  if (continuation !== undefined) continuation.phase = "running";
                  consumeSettledHostCall(target);
                  return runCapabilityReaction(onRejected, reason, "rejected", capability, budget, context);
                }
              ));
              if (continuation !== undefined) trackPromiseContinuation(completion, continuation);
              return capability.promise;
            });
          }
          observeSandboxPromise(target, true);
          const continuation: Extract<PromiseContinuation, {kind: "reaction"}> = {
            kind: "reaction", phase: "waiting", source: target, onFulfilled, onRejected
          };
          const chained = createSandboxPromise(
            target.promise.then(
              (value) => {
                continuation.phase = "running";
                consumeSettledHostCall(target);
                return runPromiseReaction(onFulfilled, value, "fulfilled", budget, chained, context);
              },
              (reason: SandboxValue) => {
                continuation.phase = "running";
                consumeSettledHostCall(target);
                return runPromiseReaction(onRejected, reason, "rejected", budget, chained, context);
              }
            )
          );
          trackPromiseContinuation(chained, continuation);
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
          if (guestProxyStates.has(then)) return callGuestProxy(then, [undefined, onRejected], budget, context, target);
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
                      pending = createSandboxPromise(resolveSandboxValue(result, { budget, context }));
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
          if (guestProxyStates.has(then)) return callGuestProxy(then, handlers, budget, context, target);
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
  });
  Object.defineProperty(prototype, Symbol.toStringTag, { value: "Promise", configurable: true });
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
  if (isSandboxPromise(receiver) && hasExplicitSandboxPrototype(receiver)) return undefined;
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
  let proxy: object | undefined;
  const descriptor = getSandboxPropertyDescriptor(receiver, property, budget, boundary => { proxy = boundary; });
  if (proxy !== undefined)
    return sandboxGetProperty(proxy as SandboxValue, property, receiver, budget, context);
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
  if (isSandboxPromise(capability.promise)) unrepresentedPromiseContinuations.add(capability.promise);
  const values: SandboxValue[] = [];
  const aggregate: PromiseAggregateState = {method, capability, values, remaining: 1, size: 0, iteration: "active"};
  promiseAggregateStates.set(aggregate, aggregate);
  let represented = true;
  try {
    const promiseResolve = await readPromiseReceiverProperty(constructor, "resolve", prototype, context);
    if (!isSandboxClosure(promiseResolve))
      throw new TypeError("Promise constructor requires a callable resolve.");
    const iterator = context === undefined ? getSandboxIterator(iterable, budget) : await acquireSandboxIterator(iterable, budget, context);
    if (iterator === undefined) throw new TypeError("Promise helpers require an iterable.");
    const releaseIterator = retainValues(budget, () => [iterator.retainedValue]);
    try {
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
          budget.allocateArrayLength(aggregate.size + 1);
          const entryIndex = aggregate.size++;
          if (method !== "race") values.push(undefined);
          const entry = await callPromiseClosure(
            promiseResolve,
            [value],
            constructor,
            budget,
            context
          );
          const aggregateEntry: PromiseAggregateEntry = {aggregate, index: entryIndex, called: false};
          const handlers = (["fulfilled", "rejected"] as const).map((state) => {
            if (method === "race" || (method === "any" && state === "fulfilled"))
              return state === "fulfilled" ? capability.resolve : capability.reject;
            if (method === "all" && state === "rejected") return capability.reject;
            return createPromiseAggregateHandler(aggregateEntry, state, budget, context);
          });
          aggregate.remaining++;
          const then = await readPromiseProperty(entry, "then", prototype, budget, context);
          if (!isSandboxClosure(then))
            throw new TypeError("Promise resolver result requires a callable then.");
          const previousReactions = isSandboxPromise(entry) ? new Set(promiseReactionResults.get(entry)) : undefined;
          const completion = await callPromiseClosure(then, handlers, entry, budget, context);
          if (!intrinsicPromiseThenMethods.has(then) || !isSandboxPromise(entry) || !isSandboxPromise(completion)) represented = false;
          else if (isSandboxPromise(capability.promise)) {
            for (const producer of promiseReactionResults.get(entry) ?? []) {
              const reaction = promiseContinuations.get(producer);
              if (!previousReactions?.has(producer) && reaction?.kind === "reaction" &&
                  reaction.onFulfilled === handlers[0] && reaction.onRejected === handlers[1])
                linkPromiseAggregateProducer(producer, capability.promise);
            }
          }
        } catch (error) {
          await closeIterator(iterator, true);
          throw error;
        }
      }
      aggregate.remaining--;
      aggregate.iteration = "complete";
      await completePromiseAggregate(aggregate, budget, context);
      if (represented && isSandboxPromise(capability.promise)) unrepresentedPromiseContinuations.delete(capability.promise);
    } finally {
      releaseIterator();
    }
  } catch (error) {
    aggregate.iteration = "abrupt";
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

async function completePromiseAggregate(aggregate: PromiseAggregateState, budget: Budget, context?: SandboxCallContext): Promise<void> {
  const {method, capability, values, remaining} = aggregate;
  if (remaining !== 0 || method === "race") return;
  if (method === "any") {
    const error = createSubsetErrorValue("AggregateError", "All promises were rejected", [], budget);
    Object.defineProperty(error, "errors", {value: values, writable: true, configurable: true});
    await callPromiseClosure(capability.reject, [budgetSandboxValue(error, budget)], undefined, budget, context);
  } else {
    await callPromiseClosure(capability.resolve, [budgetSandboxValue(values, budget)], undefined, budget, context);
  }
}

export function createPromiseAggregateHandler(entry: PromiseAggregateEntry, action: "fulfilled" | "rejected", budget: Budget, context?: SandboxCallContext): SandboxClosure {
  const {aggregate} = entry;
  promiseAggregateEntries.set(entry, entry);
  const handler = createSandboxClosure({
    sandbox: true, guest: true, name: "", length: 1,
    retainedValues: () => [aggregate.capability.promise, aggregate.capability.resolve, aggregate.capability.reject, aggregate.values],
    call: async ([settlement]) => {
      if (entry.called) return undefined;
      entry.called = true;
      const {method, values} = aggregate;
      values[entry.index] = method === "allSettled"
        ? action === "fulfilled" ? {status: action, value: settlement} : {status: action, reason: settlement}
        : settlement;
      aggregate.remaining--;
      await completePromiseAggregate(aggregate, budget, context);
      return undefined;
    }
  });
  promiseAggregateHandlers.set(handler, {entry, action});
  return handler;
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

export function prepareAwaitedPromise(
  value: SandboxPromise,
  budget: Budget,
  context?: SandboxCallContext
): SandboxPromise | Promise<SandboxPromise> {
  if (!intrinsicPromiseConstructors.has(budget)) createPromiseGlobals({ budget });
  const constructor = intrinsicPromiseConstructors.get(budget)!;
  const actualConstructor = readPromiseProperty(value, "constructor", getPromisePrototype(budget), budget, context);
  const finish = (actual: SandboxValue) => actual === constructor ? value
    : createSandboxPromise(resolveSandboxValue(value, { budget, context }), { trackReplay: false });
  return actualConstructor instanceof Promise ? actualConstructor.then(finish) : finish(actualConstructor);
}

export function resolveSandboxValue(
  value: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  options: PromiseResolutionOptions = {}
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
  options: PromiseResolutionOptions
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
      return resolvePromiseResult(value, options.budget, options.self, options.context);
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

  const then = getThenable(value, options.budget, options.context);
  if (then instanceof Promise) {
    let fulfill!: (value: SandboxValue | PromiseLike<SandboxValue>) => void;
    let reject!: (reason: unknown) => void;
    const resolved = new Promise<SandboxValue>((resolve, fail) => { fulfill = resolve; reject = fail; });
    const prefix = then.then(method => {
      try {
        fulfill(method === undefined ? budgetIfNeeded(value, options.budget) : resolveThenable(value, method, options));
      } catch (error) { reject(error); }
      return undefined;
    }, error => { reject(error); return undefined; });
    options.onSynchronousPrefix?.(prefix);
    return resolved;
  }
  if (then !== undefined) {
    return resolveThenable(value, then, options);
  }

  return Promise.resolve(budgetIfNeeded(value, options.budget));
}

function resolveThenable(
  value: SandboxValue,
  then: SandboxClosure,
  options: { budget?: Budget; self?: SandboxPromise; context?: SandboxCallContext }
): Promise<SandboxValue> {
  if (typeof value !== "object" || value === null) {
    return Promise.resolve(budgetIfNeeded(value, options.budget));
  }

  const state: ThenableContinuation = {source: value, owner: options.self,
    settlement: undefined, completed: false, invocationPending: true};
  const bridge = createThenableBridge(state, options);
  callInPromiseJob(then, bridge.resolvers, value, bridge.invocation, options.context, options.budget).catch(bridge.rejectNative);
  return bridge.promise;
}

export function createThenableBridge(
  state: ThenableContinuation,
  options: {budget?: Budget; context?: SandboxCallContext}
) {
    thenableStates.set(state, state);
    let resolve!: (value: SandboxValue | PromiseLike<SandboxValue>) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<SandboxValue>((fulfill, fail) => { resolve = fulfill; reject = fail; });
    if (state.owner !== undefined && !state.completed) thenableContinuations.set(state.owner, state);
    const complete = () => {
      if (state.completed || state.invocationPending || state.settlement === undefined) return;
      state.completed = true;
      try {
        if (state.settlement.state === "fulfilled") {
          resolve(
            requiresPromiseResolution(state.settlement.value, options.budget)
              ? resolveSandboxValueNow(state.settlement.value, {...options, self: state.owner})
              : budgetIfNeeded(state.settlement.value, options.budget)
          );
        } else {
          reject(budgetIfNeeded(state.settlement.value, options.budget));
        }
      } catch (error) {
        reject(error);
      }
    };
    const recordSettlement = (status: "fulfilled" | "rejected", settledValue: SandboxValue) => {
      if (state.settlement !== undefined) {
        return;
      }
      state.settlement = { state: status, value: settledValue };
      queueMicrotask(complete);
    };
    const resolvers = (["fulfilled", "rejected"] as const).map(action => {
      const resolver = createSandboxClosure({
        sandbox: true, guest: true, name: "", length: 1,
        retainedValues: () => [state.source, state.owner, state.settlement?.value],
        call: ([settledValue]) => {
          recordSettlement(action, settledValue);
          return undefined;
        }
      });
      thenableResolvers.set(resolver, {continuation: state, action});
      return resolver;
    });
    const invocation = {
        fulfilled: () => {
          state.invocationPending = false;
          complete();
        },
        rejected: (error: SandboxValue) => {
          state.invocationPending = false;
          if (
            error instanceof SandboxError &&
            (error.code === "budgetExceeded" || error.code === "reentry")
          ) {
            state.completed = true;
            reject(error);
            return;
          }
          recordSettlement("rejected", options.budget !== undefined && isSourceReferenceError(error)
            ? coerceThrownValue(error, options.budget, options.context?.stack ?? []) : error);
          complete();
        }
      };
    const release = () => {
      if (state.owner !== undefined && thenableContinuations.get(state.owner) === state)
        thenableContinuations.delete(state.owner);
    };
    promise.then(release, release);
    return {state, promise, resolvers, invocation, rejectNative: reject};
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
    let result = state === "rejected" && (value instanceof Error || isSourceReferenceError(value))
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
      state === "rejected" && (value instanceof Error || isSourceReferenceError(value)) ? coerceThrownValue(value, budget, []) : value;
    const rejected = (reason: unknown) => reject(isSourceReferenceError(reason)
      ? coerceThrownValue(reason, budget, context?.stack ?? []) : reason);
    const fulfilled = (result: SandboxValue | Promise<SandboxValue>) => {
      if (isPromiseLike(result)) {
        resolve(resolvePromiseResult(result, budget, self, context));
      } else if (isSelfResolution(result, self)) {
        reject(
          createSubsetErrorValue("TypeError", "Promise cannot resolve to itself.", [], budget)
        );
      } else if (requiresPromiseResolution(result, budget)) {
        resolve(resolvePromiseResult(result, budget, self, context));
      } else {
        resolve(budgetSandboxValue(result, budget));
      }
    };
    if (isSandboxClosure(handler)) {
      callInPromiseJob(handler, [argument], undefined, { fulfilled, rejected }, context, budget).catch(
        rejected
      );
    } else {
      runPromiseJob(() => {
        if (state === "fulfilled") fulfilled(value);
        else rejected(budgetSandboxValue(argument, budget));
      }).catch(rejected);
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
  context?: SandboxCallContext,
  budget?: Budget
): Promise<{ value: SandboxValue | Promise<SandboxValue> }> {
  return runPromiseJob(async () => {
    try {
      let result = guestProxyStates.has(handler)
        ? callGuestProxy(handler, args, budget ?? new Budget(), context, thisValue)
        : handler.call(args, { ...context, stack: [], thisValue, newTarget: undefined });
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

export function createPromiseAdoptionBridge(
  source: SandboxPromise,
  budget: Budget,
  owner: SandboxPromise | undefined,
  context?: SandboxCallContext
): {token: SandboxObject; bridge: PromiseAdoptionBridge} {
  let fulfill!: (value: SandboxValue | PromiseLike<SandboxValue>) => void;
  let rejectNative!: (reason: unknown) => void;
  const promise = new Promise<SandboxValue>((resolve, reject) => {
    fulfill = resolve;
    rejectNative = reject;
  });
  const token: SandboxObject = Object.create(null);
  const settle = (status: "fulfilled" | "rejected", value: SandboxValue) => {
    if (bridge.settled) return;
    bridge.settled = true;
    try {
      if (status === "rejected") rejectNative(budgetSandboxValue(value, budget));
      else if (requiresPromiseResolution(value, budget)) {
        fulfill(resolvePromiseResult(value, budget, owner, context));
      } else fulfill(budgetSandboxValue(value, budget));
    } catch (error) {
      rejectNative(error);
    }
  };
  const resolvers = (["fulfilled", "rejected"] as const).map(action => {
    const resolver = createSandboxClosure({
      sandbox: true,
      retainedValues: () => [source, owner],
      call: ([value]) => {
        settle(action, value);
        return undefined;
      }
    });
    promiseAdoptionResolvers.set(resolver, {bridge: token, action});
    return resolver;
  });
  const bridge: PromiseAdoptionBridge = {
    source, owner, settled: false, promise,
    resolve: resolvers[0], reject: resolvers[1], rejectNative
  };
  promiseAdoptionBridges.set(token, bridge);
  if (owner !== undefined) promiseAdoptions.set(owner, token);
  const release = () => {
    if (owner !== undefined && promiseAdoptions.get(owner) === token) promiseAdoptions.delete(owner);
    promiseAdoptionBridges.delete(token);
    for (const resolver of resolvers) promiseAdoptionResolvers.delete(resolver);
  };
  promise.then(release, release);
  return {token, bridge};
}

function resolvePromiseResult(
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  budget: Budget,
  self: SandboxPromise | undefined,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then((resolved) => resolvePromiseResult(resolved, budget, self, context));
  }
  if (isSelfResolution(result, self)) {
    return Promise.reject(
      createSubsetErrorValue("TypeError", "Promise cannot resolve to itself.", [], budget)
    );
  }
  if (!isSandboxPromise(result) || hasCustomPromiseThen(result, budget)) {
    return resolveSandboxValue(result, { budget, self, context });
  }
  const then = getSandboxPropertyDescriptor(result, "then", budget)?.value ?? getPromiseMember("then", budget);
  if (!isSandboxClosure(then)) return Promise.resolve(result);
  const {bridge} = createPromiseAdoptionBridge(result, budget, self, context);
  runPromiseJob(async () => {
      try {
        const completion = await callPromiseClosure(
          then,
          [bridge.resolve, bridge.reject],
          result,
          budget,
          context
        );
        if (isSandboxPromise(completion)) {
          completion.promise.catch((reason: unknown) => {
            if (
              reason instanceof SandboxError &&
              (reason.code === "budgetExceeded" || reason.code === "reentry")
            ) {
              bridge.rejectNative(reason);
            }
          });
        }
      } catch (error) {
        bridge.reject.call([error as SandboxValue]);
      }
    }).catch(bridge.rejectNative);
  return bridge.promise;
}

function isSelfResolution(result: SandboxValue, self: SandboxPromise | undefined): boolean {
  return (
    self !== undefined &&
    (result === self || (isSandboxPromise(result) && result.promise === self.promise))
  );
}

function hasCustomPromiseThen(value: SandboxValue, budget?: Budget): boolean {
  let proxy = false;
  const descriptor = getSandboxPropertyDescriptor(value, "then", budget, () => { proxy = true; });
  if (proxy) return true;
  if (descriptor === undefined && isSandboxPromise(value) && hasExplicitSandboxPrototype(value)) return true;
  return descriptor !== undefined &&
    (!isSandboxClosure(descriptor.value) || !intrinsicPromiseThenMethods.has(descriptor.value));
}

export function requiresPromiseResolution(value: SandboxValue, budget?: Budget): boolean {
  if (isSandboxPromise(value)) return true;
  let proxy = false;
  const descriptor = getSandboxPropertyDescriptor(value, "then", budget, () => { proxy = true; });
  return (
    proxy || (descriptor !== undefined && (!("value" in descriptor) || isSandboxClosure(descriptor.value)))
  );
}

function getThenable(
  value: SandboxValue,
  budget?: Budget,
  context?: SandboxCallContext
): SandboxClosure | undefined | Promise<SandboxClosure | undefined> {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  let proxy: object | undefined;
  const descriptor = getSandboxPropertyDescriptor(value, "then", budget, boundary => { proxy = boundary; });
  if (proxy !== undefined) {
    const then = sandboxGetProperty(proxy as SandboxValue, "then", value, budget ?? new Budget(), context);
    return Promise.resolve(then).then(method => isSandboxClosure(method) ? method : undefined);
  }

  if (descriptor !== undefined && !("value" in descriptor)) {
    const getter = accessorClosure(descriptor.get);
    if (getter === undefined) return undefined;
    const result =
      budget === undefined
        ? guestProxyStates.has(getter)
          ? callGuestProxy(getter, [], new Budget(), context, value)
          : getter.call([], { stack: [], thisValue: value })
        : callPromiseClosure(getter, [], value, budget, context);
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
