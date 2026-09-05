import { isFatalSandboxError, type Budget } from "../budget.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { isCapturedException } from "../exceptions.js";
import { getSandboxIterator } from "../iteration.js";
import { getSandboxDataProperty } from "../object-model.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxSet,
  isSandboxSet,
  measureSandboxData,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxMap,
  type SandboxValue
} from "../values.js";

export type CollectionGlobals = {
  Map: SandboxClosure;
  Set: SandboxClosure;
};

const mapConstructors = new WeakSet<SandboxClosure>();
const setConstructors = new WeakSet<SandboxClosure>();

export function createCollectionGlobals(options: { budget: Budget }): CollectionGlobals {
  const mapConstructor = createSandboxClosure({
    sandbox: true,
    call: () => {
      throw new TypeError("Constructor Map requires 'new'.");
    },
    construct: ([source], context) => constructMap(source, options.budget, context),
    name: "Map"
  });
  const setConstructor = createSandboxClosure({
    sandbox: true,
    call: () => {
      throw new TypeError("Constructor Set requires 'new'.");
    },
    construct: ([source]) => {
      const values = getSetValues(source);
      if (values instanceof Promise) {
        return values.then((resolved) => createBudgetedSet(resolved, options.budget));
      }
      return createBudgetedSet(values, options.budget);
    },
    name: "Set"
  });

  mapConstructors.add(mapConstructor);
  setConstructors.add(setConstructor);
  return { Map: mapConstructor, Set: setConstructor };
}

export function isSandboxMapConstructor(value: unknown): value is SandboxClosure {
  return (
    typeof value === "object" && value !== null && mapConstructors.has(value as SandboxClosure)
  );
}

export function isSandboxSetConstructor(value: unknown): value is SandboxClosure {
  return (
    typeof value === "object" && value !== null && setConstructors.has(value as SandboxClosure)
  );
}

function constructMap(source: SandboxValue, budget: Budget, context?: SandboxCallContext): SandboxMap | Promise<SandboxMap> {
  const map = createSandboxMap([]);
  budget.allocateCollectionEntries(0);
  if (source === undefined || source === null) return map;
  const iterator = getSandboxIterator(source);
  if (iterator === undefined) throw new TypeError("Map constructor requires an iterable.");
  let entry: SandboxValue;
  let key: SandboxValue;
  let value: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [source, map, entry, key, value, failure]);
  const checkData = createDataCheckpoint(budget, context);
  const closeOnThrow = (error: unknown): never | Promise<never> => {
    failure = isCapturedException(error) ? error.reason : error;
    const rethrow = (closeError?: unknown): never => {
      if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError;
      throw error;
    };
    try {
      const closing = iterator.return?.();
      if (iterator.generator) return Promise.resolve(closing).then(() => { throw error; }, rethrow);
    } catch (closeError) { return rethrow(closeError); }
    throw error;
  };
  const consume = (result: IteratorResult<SandboxValue>): boolean | Promise<never> => {
    if (typeof result !== "object" || result === null) throw new TypeError("Iterator result must be an object.");
    if (result.done) return true;
    entry = result.value;
    try {
      budget.visitNode();
      if (typeof entry !== "object" || entry === null) throw new TypeError("Map constructor requires entry objects.");
      key = context?.getProperty !== undefined ? context.getProperty(entry, 0) : getSandboxDataProperty(entry, 0, budget);
      value = context?.getProperty !== undefined ? context.getProperty(entry, 1) : getSandboxDataProperty(entry, 1, budget);
      const added = map.entries.has(key) ? 0 : 1;
      const growth = added +
        (budget.limits.dataSize === undefined ? 0 : measureSandboxData([key, value]));
      budget.allocateCollectionEntries(map.entries.size + added);
      map.entries.set(key, value);
      entry = key = value = undefined;
      checkData(map, growth);
    } catch (error) { return closeOnThrow(error); }
    return false;
  };
  if (iterator.generator) {
    return (async () => {
      try {
        checkData(map, 0, true);
        while (!(await consume(await iterator.next()))) { /* Consume each entry before advancing. */ }
        checkData(map, 0, true);
        return map;
      } finally { budget.setRetainedValues(retained, undefined); }
    })();
  }
  try {
    checkData(map, 0, true);
    while (!consume(iterator.next() as IteratorResult<SandboxValue>)) { /* Synchronous inputs stay synchronous. */ }
    checkData(map, 0, true);
    return map;
  } finally { budget.setRetainedValues(retained, undefined); }
}

function getSetValues(source: SandboxValue): SandboxValue[] | Promise<SandboxValue[]> {
  if (source === undefined || source === null) {
    return [];
  }

  if (isSandboxSet(source)) {
    return [...source.values];
  }

  if (typeof source === "string") return [...source];
  if (Array.isArray(source)) return [...source];

  const iterator = getSandboxIterator(source);
  if (iterator?.generator === true) {
    return collectSetValues(iterator);
  }
  throw new TypeError("Set constructor argument must be an array, string, or Set.");
}

async function collectSetValues(iterator: NonNullable<ReturnType<typeof getSandboxIterator>>) {
  const values: SandboxValue[] = [];
  while (true) {
    const result = await iterator.next();
    if (result.done) break;
    values.push(result.value);
  }
  return values;
}

function createBudgetedSet(values: SandboxValue[], budget: Budget) {
  budget.allocateCollectionEntries(new Set(values).size);
  return createSandboxSet(values);
}
