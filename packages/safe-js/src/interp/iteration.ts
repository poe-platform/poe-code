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
import { Budget } from "./budget.js";
import { sandboxString } from "./string-coercion.js";
import { awaitSandboxValue } from "./cancel.js";

export type SandboxIterator = {
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
