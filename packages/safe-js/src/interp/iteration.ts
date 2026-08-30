import {
  isSandboxGenerator,
  isSandboxMap,
  isSandboxSet,
  type SandboxGenerator,
  type SandboxValue
} from "./values.js";
import { enterRunningState } from "./running-state.js";
import { isFloat32Array } from "./float32.js";

export type SandboxIterator = {
  readonly generator?: true;
  snapshotIndex?(): number;
  next(value?: SandboxValue): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
  return?(
    value?: SandboxValue
  ): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
  throw?(
    error?: SandboxValue
  ): IteratorResult<SandboxValue> | Promise<IteratorResult<SandboxValue>>;
};

export function getSandboxIterator(value: SandboxValue): SandboxIterator | undefined {
  if (isFloat32Array(value)) {
    return syncIterator(Float32Array.prototype.values.call(value));
  }
  if (isSandboxGenerator(value)) {
    return generatorIterator(value);
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

function generatorIterator(generator: SandboxGenerator): SandboxIterator {
  const invoke = async (
    method: "next" | "return" | "throw",
    value?: SandboxValue
  ): Promise<IteratorResult<SandboxValue>> => {
    const leaveRunning = enterRunningState(generator);
    generator.state = "running";
    try {
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

  return {
    generator: true,
    next: (value) => invoke("next", value),
    return: (value) => invoke("return", value),
    throw: (error) => invoke("throw", error)
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
