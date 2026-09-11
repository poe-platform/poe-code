import {
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxSet,
  type SandboxGenerator,
  type SandboxCallContext,
  type SandboxValue
} from "./values.js";
import { enterRunningState } from "./running-state.js";
import { isNumericTypedArray } from "./typed-array.js";
import { typedArrayPrototypes } from "./typed-array-prototypes.js";
import { boxedValue, isSandboxBox } from "./boxed.js";
import { getHostObjectIterator, isGuestHostObject } from "./host-capabilities.js";
import { isSandboxCollectionIterator, nextCollectionIterator } from "./collection-iterator.js";
import { isSandboxRegExpIterator } from "./regexp-iterator.js";
import { nextObservableRegExpIterator, nextRegExpIterator } from "./methods/regexp-iterator.js";
import { Budget, isFatalSandboxError } from "./budget.js";
import { sandboxString } from "./string-coercion.js";
import { awaitSandboxValue, awaitWithSignal } from "./cancel.js";
import { HostCallResumabilityError } from "./host-call.js";
import { suspendJob } from "./jobs.js";
import { enqueueAsyncGeneratorRequest } from "./async-generator-driver.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { getBoxedPrototype, getSandboxPropertyDescriptor, getSandboxPrototype, hasExplicitSandboxPrototype } from "./object-model.js";
import { getIntrinsicIdentity } from "./intrinsics.js";
import { readPropertyDescriptor } from "./accessors.js";
import { createIteratorResult } from "./iterator-result.js";
import { sandboxGetProperty } from "./guest-proxy-get.js";

export type IteratorAwaitState = {kind: "result"} | {kind: "value"; done: boolean; closeOnReject: boolean};

export type SandboxIterator = {
  awaitValue?(value: SandboxValue, state: IteratorAwaitState): Promise<SandboxValue>;
  resumeAwait?(state: IteratorAwaitState, value: () => Promise<SandboxValue>): Promise<IteratorResult<SandboxValue>>;
  snapshot?(): IteratorSnapshot;
  readonly asyncProtocol?: true;
  readonly generator?: true;
  readonly asynchronous?: true;
  readonly retainedValue?: SandboxValue;
  getOperation?(method: "next" | "return" | "throw"): Promise<SandboxIterator["next"] | undefined>;
  readResultProperty?(
    result: IteratorResult<SandboxValue>,
    property: "done" | "value"
  ): Promise<{ value: SandboxValue }>;
  snapshotIndex?(): number;
  next(value?: SandboxValue): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
  return?(
    value?: SandboxValue
  ): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
  throw?(
    error?: SandboxValue
  ): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
};

export type IteratorSnapshot<T = SandboxValue> =
  | { kind: "guest"; value: T; next: T; async: boolean }
  | { kind: "builtin"; value: T; index: number }
  | { kind: "async-from-sync"; inner: IteratorSnapshot<T> }
  | { kind: "unsupported" };

export function mapIteratorSnapshot<T, U>(snapshot: IteratorSnapshot<T>, map: (value: T) => U): IteratorSnapshot<U> {
  if (snapshot.kind === "unsupported") throw new TypeError("Host-owned iterator cannot be portably snapshotted.");
  if (snapshot.kind === "async-from-sync") return { ...snapshot, inner: mapIteratorSnapshot(snapshot.inner, map) };
  return snapshot.kind === "guest" ? { ...snapshot, value: map(snapshot.value), next: map(snapshot.next) }
    : { ...snapshot, value: map(snapshot.value) };
}

export async function restoreSandboxIterator(snapshot: IteratorSnapshot, budget: Budget, context: SandboxCallContext, signal?: AbortSignal): Promise<SandboxIterator> {
  if (snapshot.kind === "unsupported") throw new TypeError("Host-owned iterator cannot be restored.");
  if (snapshot.kind === "guest") return guestIterator(snapshot.value, snapshot.next, snapshot.async, budget, context, signal);
  if (snapshot.kind === "async-from-sync") return asyncFromSyncIterator(await restoreSandboxIterator(snapshot.inner, budget, context, signal), budget, signal, context);
  if (Array.isArray(snapshot.value)) return arrayIterator(snapshot.value, context, budget, snapshot.index);
  const iterator = isSandboxGenerator(snapshot.value)
    ? { ...generatorObjectIterator(snapshot.value, budget, context),
        ...(snapshot.value.async ? { asyncProtocol: true as const } : {}) }
    : getSandboxIterator(snapshot.value, budget, context);
  if (iterator === undefined) throw new TypeError("Invalid builtin iterator snapshot.");
  // Builtin cursor restoration never invokes a guest iterator factory or next getter.
  for (let index = 0; index < snapshot.index; index++) await iterator.next();
  return iterator;
}

export async function acquireSandboxIterator(
  value: SandboxValue,
  budget: Budget,
  context: SandboxCallContext,
  asyncProtocol = false,
  signal?: AbortSignal
): Promise<SandboxIterator | undefined> {
  const key = asyncProtocol ? Symbol.asyncIterator : Symbol.iterator;
  if (context.getProperty === undefined || isGuestHostObject(value))
    return asyncProtocol
      ? getSandboxAsyncIterator(value, budget, context, signal)
      : getSandboxIterator(value, budget, context);
  const lookupTarget = value !== undefined && value !== null && typeof value !== "object"
    ? getBoxedPrototype(value, budget) : value;
  let proxy = false;
  const descriptor = getSandboxPropertyDescriptor(lookupTarget, key, budget, () => { proxy = true; });
  if (descriptor === undefined && !proxy &&
      !(isSandboxRegExpIterator(value) && !asyncProtocol && getSandboxPropertyDescriptor(value, "next", budget) !== undefined)) {
    if (isSandboxGenerator(value)) {
      if (!hasExplicitSandboxPrototype(value) && (value.async === true) === asyncProtocol && getSandboxPropertyDescriptor(value, "next", budget) !== undefined)
        return guestIterator(value, await context.getProperty(value, "next"), asyncProtocol, budget, context, signal);
    }
    // An installed guest prototype makes the absence of the method observable.
    // Only legacy callers without that prototype may use implicit built-ins.
    if (!asyncProtocol && (typeof value === "string" ? lookupTarget !== undefined
      : (Array.isArray(value) || isSandboxBox(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxCollectionIterator(value)) &&
        (hasExplicitSandboxPrototype(value) || getSandboxPrototype(value, budget) !== null))) return undefined;
    if (!asyncProtocol) return getSandboxIterator(value, budget, context);
    if (isSandboxGenerator(value) && value.async && !hasExplicitSandboxPrototype(value))
      return getSandboxAsyncIterator(value, budget, context, signal);
    const iterator = await acquireSandboxIterator(value, budget, context);
    return iterator === undefined ? undefined : asyncFromSyncIterator(iterator, budget, signal, context);
  }
  const factory = await context.getProperty(value, key);
  // Legacy interpret callers can supply built-ins installed under another
  // budget while their evaluation context still uses implicit array iteration.
  if (!asyncProtocol && factory === undefined && Array.isArray(value) && !hasExplicitSandboxPrototype(value)) {
    const installed = getSandboxPropertyDescriptor(value, key, budget)?.value;
    if (typeof installed === "object" && installed !== null &&
        getIntrinsicIdentity(installed) === JSON.stringify(["Array", "prototype", "values"]))
      return arrayIterator(value, context, budget);
  }
  if (factory === null || factory === undefined) {
    if (!asyncProtocol) return undefined;
    const iterator = await acquireSandboxIterator(value, budget, context);
    return iterator === undefined ? undefined : asyncFromSyncIterator(iterator, budget, signal, context);
  }
  return getSandboxIteratorFromMethod(value, factory, budget, context, asyncProtocol, signal);
}

export async function getSandboxIteratorFromMethod(
  value: SandboxValue,
  factory: SandboxValue,
  budget: Budget,
  context: SandboxCallContext,
  asyncProtocol = false,
  signal?: AbortSignal
): Promise<SandboxIterator> {
  if (!asyncProtocol && (isSandboxMap(value) || isSandboxSet(value)) &&
      typeof factory === "object" && factory !== null &&
      getIntrinsicIdentity(factory) === JSON.stringify(isSandboxMap(value)
        ? ["Map", "prototype", "entries"] : ["Set", "prototype", "values"])) {
    return getSandboxIterator(value, budget, context)!;
  }
  if (!isSandboxClosure(factory)) {
    if (typeof factory !== "function") throw new TypeError("Iterator method must be callable.");
    if (asyncProtocol) return nativeAsyncIterator(value, factory, signal);
    const iterator = Reflect.apply(factory, value, []) as Iterator<SandboxValue>;
    if ((typeof iterator !== "object" && typeof iterator !== "function") || iterator === null)
      throw new TypeError("Iterator must be an object.");
    return syncIterator(iterator);
  }
  const iterator = await invokeBuiltinClosure(factory, [], budget, context, value);
  if ((typeof iterator !== "object" && typeof iterator !== "function") || iterator === null)
    throw new TypeError("Iterator must be an object.");
  if (!asyncProtocol && isSandboxGenerator(iterator) && !iterator.async &&
      !hasExplicitSandboxPrototype(iterator) && getSandboxPropertyDescriptor(iterator, "next", budget) === undefined)
    return getSandboxIterator(iterator, budget, context)!;
  const next = await context.getProperty!(iterator, "next");
  return guestIterator(iterator, next, asyncProtocol, budget, context, signal);
}

function guestIterator(iterator: SandboxValue, next: SandboxValue, asyncProtocol: boolean, budget: Budget, context: SandboxCallContext, signal?: AbortSignal): SandboxIterator {
  const resumeAwait = async (state: IteratorAwaitState, value: () => Promise<SandboxValue>): Promise<IteratorResult<SandboxValue>> => {
    if (state.kind !== "result") throw new TypeError("Invalid async iterator await state.");
    const result = await value();
    if ((typeof result !== "object" && typeof result !== "function") || result === null)
      throw new TypeError("Iterator result must be an object.");
    return result as unknown as IteratorResult<SandboxValue>;
  };
  const invoke = async (
    operation: SandboxValue,
    args: readonly SandboxValue[]
  ): Promise<IteratorResult<SandboxValue>> => {
    if (!isSandboxClosure(operation)) throw new TypeError("Iterator operation must be callable.");
    const returned = await invokeBuiltinClosure(operation, args, budget, context, iterator);
    if (asyncProtocol && wrapper.awaitValue !== undefined)
      return resumeAwait({kind: "result"}, () => wrapper.awaitValue!(returned, {kind: "result"}));
    const result = asyncProtocol ? await awaitSandboxValue(returned, signal, budget, context) : returned;
    if ((typeof result !== "object" && typeof result !== "function") || result === null)
      throw new TypeError("Iterator result must be an object.");
    return result as unknown as IteratorResult<SandboxValue>;
  };
  const wrapper: SandboxIterator = {
    resumeAwait,
    ...(asyncProtocol ? { asyncProtocol: true as const } : {}),
    asynchronous: true,
    retainedValue: [iterator, next],
    snapshot: () => ({ kind: "guest", value: iterator, next, async: asyncProtocol }),
    next: (...args) => invoke(next, args),
    getOperation: async (method) => {
      const operation = method === "next" ? next : await context.getProperty!(iterator, method);
      return method !== "next" && (operation === undefined || operation === null)
        ? undefined
        : (...args) => invoke(operation, args);
    },
    readResultProperty: async (result, property) => ({
      value: await context.getProperty!(result as unknown as SandboxValue, property)
    })
  };
  return wrapper;
}

export async function readIteratorResult(
  iterator: SandboxIterator,
  result: IteratorResult<SandboxValue>,
  property: "done" | "value"
): Promise<{ value: SandboxValue }> {
  // Box the property value so this runtime await does not assimilate a guest value.
  return iterator.readResultProperty === undefined
    ? { value: result[property] }
    : iterator.readResultProperty(result, property);
}

export function getSandboxAsyncIterator(
  value: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext,
  signal?: AbortSignal
): SandboxIterator | undefined {
  if (isSandboxGenerator(value) && value.async) {
    return hasExplicitSandboxPrototype(value) ? context?.getProperty === undefined
      ? guestProtocolAdapter(value, budget, context, true, signal) : undefined
      : { ...generatorObjectIterator(value, budget, context), asyncProtocol: true };
  }
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    !isGuestHostObject(value)
  ) {
    const method = (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
    if (method !== undefined && method !== null) {
      return nativeAsyncIterator(value, method, signal);
    }
  }
  const iterator = getSandboxIterator(value, budget, context);
  return iterator === undefined ? undefined : asyncFromSyncIterator(iterator, budget, signal, context);
}

function nativeAsyncIterator(
  value: SandboxValue,
  method: unknown,
  signal?: AbortSignal
): SandboxIterator {
  if (typeof method !== "function") throw new TypeError("Async iterator method must be callable.");
  const iterator = Reflect.apply(method, value, []) as Record<string, unknown>;
  if ((typeof iterator !== "object" && typeof iterator !== "function") || iterator === null) {
    throw new TypeError("Async iterator must be an object.");
  }
  const next = iterator.next;
  const invoke = async (
    operation: unknown,
    args: readonly SandboxValue[]
  ): Promise<IteratorResult<SandboxValue>> => {
    if (typeof operation !== "function")
      throw new TypeError("Async iterator operation must be callable.");
    const pending = Promise.resolve(Reflect.apply(operation, iterator, args)).then((result) => ({
      result
    }));
    const { result } = await awaitWithSignal(pending, signal);
    if ((typeof result !== "object" && typeof result !== "function") || result === null) {
      throw new TypeError("Iterator result must be an object.");
    }
    // Keep protocol reads lazy without re-assimilating the result's `then` property.
    return {
      get done() {
        return result.done;
      },
      get value() {
        return result.value;
      }
    };
  };
  return {
    asyncProtocol: true,
    retainedValue: value,
    next: (...args) => invoke(next, args),
    get return() {
      const operation = iterator.return;
      return operation === undefined || operation === null
        ? undefined
        : (...args: [value?: SandboxValue]) => invoke(operation, args);
    },
    get throw() {
      const operation = iterator.throw;
      return operation === undefined || operation === null
        ? undefined
        : (...args: [value?: SandboxValue]) => invoke(operation, args);
    }
  };
}

function asyncFromSyncIterator(
  iterator: SandboxIterator,
  budget: Budget,
  signal?: AbortSignal,
  context?: SandboxCallContext
): SandboxIterator {
  const resumeAwait = async (state: IteratorAwaitState, value: () => Promise<SandboxValue>): Promise<IteratorResult<SandboxValue>> => {
    if (state.kind !== "value") throw new TypeError("Invalid async-from-sync await state.");
    try {return {done: state.done, value: await value()};}
    catch (error) {
      if (isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
      if (state.closeOnReject) await closeIterator(iterator, true);
      throw error;
    }
  };
  const invoke = async (
    method: "next" | "return" | "throw",
    args: [value?: SandboxValue]
  ): Promise<IteratorResult<SandboxValue>> => {
    const operation =
      iterator.getOperation === undefined ? iterator[method] : await iterator.getOperation(method);
    if (operation === undefined) {
      if (method === "throw") {
        await closeIterator(iterator);
        throw new TypeError("Delegated iterator does not provide a throw method.");
      }
      return { done: true, value: args[0] };
    }
    const returned = operation(...args);
    const result =
      iterator.generator || iterator.asynchronous
        ? await returned
        : (returned as IteratorResult<SandboxValue>);
    if ((typeof result !== "object" && typeof result !== "function") || result === null) {
      throw new TypeError("Iterator result must be an object.");
    }
    const done = Boolean((await readIteratorResult(iterator, result, "done")).value);
    const resultValue = (await readIteratorResult(iterator, result, "value")).value;
    if (wrapper.awaitValue !== undefined) {
      const state: IteratorAwaitState = {kind: "value", done, closeOnReject: !done && method !== "return"};
      return resumeAwait(state, () => wrapper.awaitValue!(resultValue, state));
    }
    try {
      return { done, value: await awaitSandboxValue(resultValue, signal, budget, context) };
    } catch (error) {
      if (isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
      if (!done && method !== "return") await closeIterator(iterator, true);
      throw error;
    }
  };
  const wrapper: SandboxIterator = {
    resumeAwait,
    asyncProtocol: true,
    snapshotIndex: iterator.snapshotIndex,
    snapshot: () => ({ kind: "async-from-sync", inner: iterator.snapshot?.() ?? { kind: "unsupported" } }),
    get retainedValue() {
      return iterator.retainedValue;
    },
    next: (...args) => invoke("next", args),
    return: (...args) => invoke("return", args),
    throw: (...args) => invoke("throw", args)
  };
  return wrapper;
}

export async function closeIterator(
  iterator: SandboxIterator,
  preserveThrow = false,
  awaitResult: <T>(pending: Promise<T>) => Promise<T> = suspendJob
): Promise<void> {
  try {
    const close =
      iterator.getOperation === undefined ? iterator.return : await iterator.getOperation("return");
    if (close === undefined) return;
    const returned = close();
    const result = iterator.asyncProtocol
      ? iterator.awaitValue === undefined ? await awaitResult(Promise.resolve(returned)) : await returned
      : iterator.generator || iterator.asynchronous
        ? await returned
        : returned;
    if ((typeof result !== "object" && typeof result !== "function") || result === null) {
      throw new TypeError("Iterator return result must be an object.");
    }
  } catch (error) {
    if (!preserveThrow || isFatalSandboxError(error) || error instanceof HostCallResumabilityError)
      throw error;
  }
}

export function getSandboxIterator(
  value: SandboxValue,
  budget?: Budget,
  context?: SandboxCallContext
): SandboxIterator | undefined {
  if (isSandboxBox(value) && typeof boxedValue(value) === "string") {
    const primitive = boxedValue(value);
    let text: string | undefined;
    let iterator: SandboxIterator | undefined;
    let initialized: Promise<void> | undefined;
    return {
      asynchronous: true,
      get retainedValue() {
        return text === primitive ? undefined : text;
      },
      next: async () => {
        initialized ??= Promise.resolve(sandboxString(value, budget ?? new Budget(), context)).then(
          (converted) => {
            text = converted;
            iterator = syncIterator(converted[Symbol.iterator]());
          }
        );
        await initialized;
        return iterator!.next();
      }
    };
  }
  if (isSandboxCollectionIterator(value) && hasExplicitSandboxPrototype(value))
    return context?.getProperty === undefined ? guestProtocolAdapter(value, budget ?? new Budget(), context, false) : undefined;
  if (isSandboxCollectionIterator(value))
    return { next: () => nextCollectionIterator(value, budget), snapshotIndex: () => 0,
      snapshot: () => ({ kind: "builtin", value, index: 0 }) };
  if (isSandboxRegExpIterator(value) && hasExplicitSandboxPrototype(value))
    return context?.getProperty === undefined ? guestProtocolAdapter(value, budget ?? new Budget(), context, false) : undefined;
  if (isSandboxRegExpIterator(value)) {
    if (context !== undefined && budget !== undefined)
      return { asynchronous: true, next: () => nextObservableRegExpIterator(value, budget, context), snapshotIndex: () => 0,
        snapshot: () => ({ kind: "builtin", value, index: 0 }) };
    return { next: () => nextRegExpIterator(value, budget), snapshotIndex: () => 0,
      snapshot: () => ({ kind: "builtin", value, index: 0 }) };
  }
  if (isGuestHostObject(value)) return getHostObjectIterator(value);
  if (isNumericTypedArray(value)) {
    if (hasExplicitSandboxPrototype(value) || (budget !== undefined && typedArrayPrototypes.has(budget))) {
      if (getSandboxPropertyDescriptor(value, Symbol.iterator, budget) === undefined) return undefined;
      return guestProtocolAdapter(value, budget ?? new Budget(), context, false);
    }
    return syncIterator(Float32Array.prototype.values.call(value));
  }
  if (isSandboxGenerator(value)) {
    if (value.async) return undefined;
    if (hasExplicitSandboxPrototype(value)) return context?.getProperty === undefined
      ? guestProtocolAdapter(value, budget ?? new Budget(), context, false) : undefined;
    return generatorObjectIterator(value, budget, context);
  }

  if (typeof value === "string") {
    const iterator = value[Symbol.iterator]();
    let index = 0;
    return {
      snapshot: () => ({ kind: "builtin", value, index }),
      next: () => {
        const result = iterator.next();
        if (!result.done) index++;
        return result;
      }
    };
  }

  if (isSandboxMap(value)) {
    return collectionIterator(value.entries, value);
  }

  if (isSandboxSet(value)) {
    return collectionIterator(value.values, value);
  }

  if (Array.isArray(value) && hasExplicitSandboxPrototype(value))
    return context?.getProperty === undefined
      ? guestProtocolAdapter(value, budget ?? new Budget(), context, false) : undefined;
  if (Array.isArray(value) && context?.getProperty !== undefined) {
    return arrayIterator(value, context, budget);
  }

  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const iteratorMethod = (value as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (iteratorMethod === undefined || iteratorMethod === null) return undefined;
  if (typeof iteratorMethod !== "function") {
    throw new TypeError("Iterator method must be callable.");
  }

  const iterator = Reflect.apply(iteratorMethod, value, []) as Iterator<SandboxValue>;
  if ((typeof iterator !== "object" && typeof iterator !== "function") || iterator === null) {
    throw new TypeError("Iterator must be an object.");
  }
  return syncIterator(iterator);
}

function arrayIterator(value: SandboxValue[], context: SandboxCallContext, budget?: Budget, initialIndex = 0): SandboxIterator {
  let index = initialIndex;
  return {
    asynchronous: true,
    snapshotIndex: () => index,
    snapshot: () => ({ kind: "builtin", value, index }),
    next: async () => {
      if (index >= value.length) return { done: true, value: undefined };
      budget?.visitNode();
      return { done: false, value: await context.getProperty!(value, index++) };
    }
  };
}

function collectionIterator(
  collection: Map<SandboxValue, SandboxValue> | Set<SandboxValue>,
  value: SandboxValue
): SandboxIterator {
  let iterator: Iterator<SandboxValue> = collection[Symbol.iterator]();
  let exhausted = false;
  const adapter: SandboxIterator = {
    ...syncIterator({
      next: () => {
        if (exhausted) return { done: true, value: undefined };
        const result = iterator.next();
        exhausted = result.done === true;
        return result;
      }
    }),
    snapshotIndex: () => {
      if (exhausted) return collection.size;
      let remaining = 0;
      while (!iterator.next().done) remaining += 1;
      const index = collection.size - remaining;
      iterator = collection[Symbol.iterator]();
      for (let skipped = 0; skipped < index; skipped += 1) iterator.next();
      return index;
    }
  };
  adapter.snapshot = () => ({ kind: "builtin", value, index: adapter.snapshotIndex!() });
  return adapter;
}


function guestProtocolAdapter(
  value: SandboxValue,
  budget: Budget,
  context: SandboxCallContext | undefined,
  asyncProtocol: boolean,
  signal?: AbortSignal
): SandboxIterator {
  // Direct adapters still need guest property reads, receiver binding and
  // cached next methods without exposing native iterator objects.
  const bridge: SandboxCallContext = {
    ...context,
    stack: context?.stack ?? [],
    thisValue: value,
    invokeClosure: (closure, args, receiver, construct) => invokeBuiltinClosure(closure, args, budget, context, receiver, construct),
    getProperty: (target, key) => {
      const descriptor = getSandboxPropertyDescriptor(target, key, budget);
      return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, target, bridge, true);
    }
  };
  let resolved: SandboxIterator | undefined;
  let pending: Promise<SandboxIterator> | undefined;
  const initialize = () => pending ??= acquireSandboxIterator(value, budget, bridge, asyncProtocol, signal).then(iterator => {
    if (iterator === undefined) throw new TypeError("Value does not provide an iterator protocol.");
    return resolved = iterator;
  });
  return {
    asynchronous: true,
    ...(asyncProtocol ? { asyncProtocol: true as const } : {}),
    get retainedValue() { return [value, resolved?.retainedValue]; },
    snapshot: () => resolved?.snapshot?.() ?? { kind: "unsupported" },
    next: async (...args) => (await initialize()).next(...args),
    getOperation: async method => {
      const iterator = await initialize();
      return iterator.getOperation === undefined ? iterator[method] : iterator.getOperation(method);
    },
    readResultProperty: async (result, property) => readIteratorResult(await initialize(), result, property)
  };
}

function generatorObjectIterator(generator: SandboxGenerator, budget?: Budget, context?: SandboxCallContext): SandboxIterator {
  const iterator = generatorIterator(generator, budget, context);
  if (context?.getProperty === undefined) return iterator;
  return {
    ...iterator,
    getOperation: async method => {
      if (method === "next" || (!hasExplicitSandboxPrototype(generator) &&
          getSandboxPropertyDescriptor(generator, method, budget) === undefined)) return iterator[method];
      const operation = await context.getProperty!(generator, method);
      if (operation === undefined || operation === null) return undefined;
      if (!isSandboxClosure(operation)) throw new TypeError("Iterator operation must be callable.");
      return async (...args) => {
        const result = await invokeBuiltinClosure(operation, args, budget ?? new Budget(), context, generator);
        return (generator.async ? await awaitSandboxValue(result, undefined, budget, context) : result) as unknown as IteratorResult<SandboxValue>;
      };
    },
    readResultProperty: async (result, property) => ({
      value: await context.getProperty!(result as unknown as SandboxValue, property)
    })
  };
}

export function generatorIterator(generator: SandboxGenerator, budget?: Budget, context?: SandboxCallContext): SandboxIterator {
  const invoke = async (
    method: "next" | "return" | "throw",
    value?: SandboxValue
  ): Promise<IteratorResult<SandboxValue>> => {
    const leaveRunning = enterRunningState(generator);
    generator.state = "running";
    try {
      const result = await generator.channel[method](value);
      generator.state = result.done ? "done" : "suspended";
      return result.yieldedResult !== undefined
        ? result.yieldedResult as IteratorResult<SandboxValue>
        : createIteratorResult(result.value as SandboxValue, result.done === true, budget);
    } catch (error) {
      generator.state = "done";
      throw error;
    } finally {
      leaveRunning();
    }
  };

  const request = (method: "next" | "return" | "throw", value?: SandboxValue) => {
    if (!generator.async) return invoke(method, value);
    return enqueueAsyncGeneratorRequest(generator, method, value, budget ?? new Budget(), context).promise as unknown as Promise<IteratorResult<SandboxValue>>;
  };

  return {
    generator: true,
    snapshot: () => ({ kind: "builtin", value: generator, index: 0 }),
    readResultProperty: async (result, property) => ({ value: context?.getProperty !== undefined
      ? await context.getProperty(result as unknown as SandboxValue, property)
      : await sandboxGetProperty(result as unknown as SandboxValue, property, result as unknown as SandboxValue, budget ?? new Budget(), context) }),
    next: (value) => request("next", value),
    return: (value) => request("return", value),
    throw: (error) => request("throw", error)
  };
}

function syncIterator(iterator: Iterator<SandboxValue>): SandboxIterator {
  const next = iterator.next;
  const invoke = (
    method: (...args: [] | [SandboxValue]) => IteratorResult<SandboxValue>,
    args: readonly SandboxValue[]
  ) => {
    const leaveRunning = enterRunningState(iterator as object);
    try {
      return Reflect.apply(method, iterator, args);
    } finally {
      leaveRunning();
    }
  };
  return {
    next: (...args: [value?: SandboxValue]) => invoke(next, args),
    get return() {
      const method = iterator.return;
      if (method === undefined || method === null) return undefined;
      if (typeof method !== "function") throw new TypeError("Iterator return must be callable.");
      return (...args: [value?: SandboxValue]) => invoke(method, args);
    },
    get throw() {
      const method = iterator.throw;
      if (method === undefined || method === null) return undefined;
      if (typeof method !== "function") throw new TypeError("Iterator throw must be callable.");
      return (...args: [value?: SandboxValue]) => invoke(method, args);
    }
  };
}
