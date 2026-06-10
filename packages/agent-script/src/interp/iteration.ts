import {
  isSandboxGenerator,
  isSandboxMap,
  isSandboxSet,
  type SandboxArray,
  type SandboxGenerator,
  type SandboxValue
} from "./values.js";

export type SandboxIterator = {
  readonly generator?: true;
  next(value?: SandboxValue): Promise<IteratorResult<SandboxValue>>;
  return?(value?: SandboxValue): Promise<IteratorResult<SandboxValue>>;
  throw?(error?: SandboxValue): Promise<IteratorResult<SandboxValue>>;
};

export function getSandboxIterator(value: SandboxValue): SandboxIterator | undefined {
  if (isSandboxGenerator(value)) {
    return generatorIterator(value);
  }

  if (typeof value === "string") {
    return syncIterator(value[Symbol.iterator]());
  }

  if (isSandboxMap(value)) {
    return syncIterator(
      Array.from(value.entries, ([key, entry]) => [key, entry] as SandboxArray)[Symbol.iterator]()
    );
  }

  if (isSandboxSet(value)) {
    return syncIterator(value.values[Symbol.iterator]());
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

function generatorIterator(generator: SandboxGenerator): SandboxIterator {
  const invoke = async (
    method: "next" | "return" | "throw",
    value?: SandboxValue
  ): Promise<IteratorResult<SandboxValue>> => {
    generator.state = "running";
    try {
      const result = (await generator.channel[method](value)) as IteratorResult<SandboxValue>;
      generator.state = result.done ? "done" : "suspended";
      return result;
    } catch (error) {
      generator.state = "done";
      throw error;
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
  return {
    next: (value) => Promise.resolve(iterator.next(value)),
    ...(typeof iterator.return === "function"
      ? { return: (value?: SandboxValue) => Promise.resolve(iterator.return!(value)) }
      : {}),
    ...(typeof iterator.throw === "function"
      ? { throw: (error?: SandboxValue) => Promise.resolve(iterator.throw!(error)) }
      : {})
  };
}
