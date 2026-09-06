import {
  isSandboxGenerator,
  isSandboxMap,
  isSandboxSet,
  type SandboxGenerator,
  type SandboxCallContext,
  type SandboxValue
} from "./values.js";
import { enterRunningState } from "./running-state.js";
import { isFloat32Array } from "./float32.js";
import { boxedValue, isSandboxBox } from "./boxed.js";
import { getHostObjectIterator, isGuestHostObject } from "./host-capabilities.js";
import { isSandboxCollectionIterator, nextCollectionIterator } from "./collection-iterator.js";
import { Budget, isFatalSandboxError } from "./budget.js";
import { sandboxString } from "./string-coercion.js";
import { awaitSandboxValue, awaitWithSignal } from "./cancel.js";
import { HostCallResumabilityError } from "./host-call.js";
import { suspendJob } from "./jobs.js";

export type SandboxIterator = {
  readonly asyncProtocol?: true;
  readonly generator?: true;
  readonly asynchronous?: true;
  readonly retainedValue?: SandboxValue;
  snapshotIndex?(): number;
  next(value?: SandboxValue): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
  return?(
    value?: SandboxValue
  ): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
  throw?(
    error?: SandboxValue
  ): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
};

export function getSandboxAsyncIterator(
  value: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext,
  signal?: AbortSignal
): SandboxIterator | undefined {
  if (isSandboxGenerator(value) && value.async) {
    return { ...generatorIterator(value, budget), asyncProtocol: true };
  }
  if (value !== null && (typeof value === "object" || typeof value === "function") && !isGuestHostObject(value)) {
    const method = (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
    if (method !== undefined && method !== null) {
      if (typeof method !== "function") throw new TypeError("Async iterator method must be callable.");
      const iterator = Reflect.apply(method, value, []) as Record<string, unknown>;
      if ((typeof iterator !== "object" && typeof iterator !== "function") || iterator === null) {
        throw new TypeError("Async iterator must be an object.");
      }
      const next = iterator.next;
      const invoke = async (operation: unknown, args: readonly SandboxValue[]): Promise<IteratorResult<SandboxValue>> => {
        if (typeof operation !== "function") throw new TypeError("Async iterator operation must be callable.");
        const pending = Promise.resolve(Reflect.apply(operation, iterator, args)).then(result => ({result}));
        const { result } = await awaitWithSignal(pending, signal);
        if ((typeof result !== "object" && typeof result !== "function") || result === null) {
          throw new TypeError("Iterator result must be an object.");
        }
        // Keep protocol reads lazy without re-assimilating the result's `then` property.
        return {
          get done() { return result.done; },
          get value() { return result.value; }
        };
      };
      return {
        asyncProtocol: true,
        retainedValue: value,
        next: (...args) => invoke(next, args),
        get return() {
          const operation = iterator.return;
          return operation === undefined || operation === null ? undefined : (...args: [value?: SandboxValue]) => invoke(operation, args);
        },
        get throw() {
          const operation = iterator.throw;
          return operation === undefined || operation === null ? undefined : (...args: [value?: SandboxValue]) => invoke(operation, args);
        }
      };
    }
  }
  const iterator = getSandboxIterator(value, budget, context);
  if (iterator === undefined) return undefined;
  const invoke = async (method: "next" | "return" | "throw", args: [value?: SandboxValue]): Promise<IteratorResult<SandboxValue>> => {
    const operation = iterator[method];
    if (operation === undefined) {
      if (method === "throw") {
        await closeIterator(iterator);
        throw new TypeError("Delegated iterator does not provide a throw method.");
      }
      return {done:true,value:args[0]};
    }
    const returned = operation(...args);
    const result = iterator.generator || iterator.asynchronous ? await returned : returned as IteratorResult<SandboxValue>;
    if ((typeof result !== "object" && typeof result !== "function") || result === null) {
      throw new TypeError("Iterator result must be an object.");
    }
    const done = Boolean(result.done);
    const resultValue = result.value;
    try {
      return {done,value:await awaitSandboxValue(resultValue, signal, budget)};
    } catch (error) {
      if (isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
      if (!done && method !== "return") await closeIterator(iterator, true);
      throw error;
    }
  };
  return {
    asyncProtocol: true,
    snapshotIndex: iterator.snapshotIndex,
    get retainedValue() { return iterator.retainedValue; },
    next: (...args) => invoke("next", args),
    return: (...args) => invoke("return", args),
    throw: (...args) => invoke("throw", args)
  };
}

export async function closeIterator(iterator: SandboxIterator, preserveThrow = false): Promise<void> {
  try {
    const close = iterator.return;
    if (close === undefined) return;
    const returned = close();
    const result = iterator.asyncProtocol ? await suspendJob(Promise.resolve(returned))
      : iterator.generator || iterator.asynchronous ? await returned : returned;
    if ((typeof result !== "object" && typeof result !== "function") || result === null) {
      throw new TypeError("Iterator return result must be an object.");
    }
  } catch (error) {
    if (!preserveThrow || isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
  }
}

export function getSandboxIterator(value: SandboxValue, budget?: Budget, context?: SandboxCallContext): SandboxIterator | undefined {
  if (isSandboxBox(value) && typeof boxedValue(value) === "string") {
    const primitive = boxedValue(value);
    let text: string | undefined;
    let iterator: SandboxIterator | undefined;
    let initialized: Promise<void> | undefined;
    return {
      asynchronous: true,
      get retainedValue() { return text === primitive ? undefined : text; },
      next: async () => {
        initialized ??= Promise.resolve(sandboxString(value, budget ?? new Budget(), context)).then(converted => {
          text = converted;
          iterator = syncIterator(converted[Symbol.iterator]());
        });
        await initialized;
        return iterator!.next();
      }
    };
  }
  if (isSandboxCollectionIterator(value)) return { next: () => nextCollectionIterator(value, budget), snapshotIndex: () => 0 };
  if (isGuestHostObject(value)) return getHostObjectIterator(value);
  if (isFloat32Array(value)) {
    return syncIterator(Float32Array.prototype.values.call(value));
  }
  if (isSandboxGenerator(value)) {
    return value.async ? undefined : generatorIterator(value);
  }

  if (typeof value === "string") {
    return syncIterator(value[Symbol.iterator]());
  }

  if (isSandboxMap(value)) {
    return collectionIterator(value.entries);
  }

  if (isSandboxSet(value)) {
    return collectionIterator(value.values);
  }

  if (Array.isArray(value) && context?.getProperty !== undefined) {
    let index = 0;
    return {
      asynchronous: true,
      snapshotIndex: () => index,
      next: async () => {
        if (index >= value.length) return { done: true, value: undefined };
        budget?.visitNode();
        return { done: false, value: await context.getProperty!(value, index++) };
      }
    };
  }

  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const iteratorMethod = (value as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iteratorMethod !== "function") {
    return undefined;
  }

  return syncIterator(Reflect.apply(iteratorMethod, value, []) as Iterator<SandboxValue>);
}

function collectionIterator(
  collection: Map<SandboxValue, SandboxValue> | Set<SandboxValue>
): SandboxIterator {
  let iterator: Iterator<SandboxValue> = collection[Symbol.iterator]();
  let exhausted = false;
  return {
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
}

const asyncGeneratorRequests = new WeakMap<SandboxGenerator, Promise<unknown>>();

export function generatorIterator(generator: SandboxGenerator, budget?: Budget): SandboxIterator {
  const invoke = async (
    method: "next" | "return" | "throw",
    value?: SandboxValue
  ): Promise<IteratorResult<SandboxValue>> => {
    const leaveRunning = enterRunningState(generator);
    const initialState = generator.state;
    generator.state = "running";
    try {
      if (generator.async && method === "return" && (initialState === "start" || initialState === "done")) {
        if (initialState === "start") await generator.channel.return();
        value = await awaitSandboxValue(value, undefined, budget);
      }
      const result = (await generator.channel[method](value)) as IteratorResult<SandboxValue>;
      generator.state = result.done ? "done" : "suspended";
      return result;
    } catch (error) {
      generator.state = "done";
      throw error;
    } finally {
      leaveRunning();
    }
  };

  const request = (method: "next" | "return" | "throw", value?: SandboxValue) => {
    if (!generator.async) return invoke(method, value);
    const previous = asyncGeneratorRequests.get(generator) ?? Promise.resolve();
    const result = previous.then(() => invoke(method, value));
    asyncGeneratorRequests.set(generator, result.catch(() => undefined));
    return result;
  };

  return {
    generator: true,
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
