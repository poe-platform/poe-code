import { isFatalSandboxError, type Budget } from "../budget.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { isCapturedException } from "../exceptions.js";
import { getSandboxIterator } from "../iteration.js";
import { getSandboxDataProperty } from "../object-model.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxSet,
  measureSandboxData,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxMap,
  type SandboxSet,
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
    construct: ([source], context) => {
      const map = createSandboxMap([]);
      let key: SandboxValue;
      let value: SandboxValue;
      return populateCollection(source, map, {
        name: "Map",
        budget: options.budget,
        context,
        retainedValues: () => [key, value],
        append: (entry) => {
          if (typeof entry !== "object" || entry === null)
            throw new TypeError("Map constructor requires entry objects.");
          const store = (entryValue: SandboxValue) => {
            value = entryValue;
            const added = map.entries.has(key) ? 0 : 1;
            const growth =
              added +
              (options.budget.limits.dataSize === undefined ? 0 : measureSandboxData([key, value]));
            options.budget.allocateCollectionEntries(map.entries.size + added);
            map.entries.set(key, value);
            key = value = undefined;
            return growth;
          };
          const readValue = (entryKey: SandboxValue) => {
            key = entryKey;
            const result =
              context?.getProperty !== undefined
                ? context.getProperty(entry, 1)
                : getSandboxDataProperty(entry, 1, options.budget);
            return result instanceof Promise ? result.then(store) : store(result);
          };
          const result =
            context?.getProperty !== undefined
              ? context.getProperty(entry, 0)
              : getSandboxDataProperty(entry, 0, options.budget);
          return result instanceof Promise ? result.then(readValue) : readValue(result);
        }
      });
    },
    name: "Map"
  });
  const setConstructor = createSandboxClosure({
    sandbox: true,
    call: () => {
      throw new TypeError("Constructor Set requires 'new'.");
    },
    construct: ([source], context) => {
      const set = createSandboxSet([]);
      return populateCollection(source, set, {
        name: "Set",
        budget: options.budget,
        context,
        append: (value) => {
          const added = set.values.has(value) ? 0 : 1;
          const growth =
            added +
            (options.budget.limits.dataSize === undefined ? 0 : measureSandboxData([value]));
          options.budget.allocateCollectionEntries(set.values.size + added);
          set.values.add(value);
          return growth;
        }
      });
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

function populateCollection<T extends SandboxMap | SandboxSet>(
  source: SandboxValue,
  collection: T,
  {
    name,
    budget,
    context,
    append,
    retainedValues
  }: {
    name: "Map" | "Set";
    budget: Budget;
    context?: SandboxCallContext;
    append: (value: SandboxValue) => number | Promise<number>;
    retainedValues?: () => Iterable<SandboxValue>;
  }
): T | Promise<T> {
  budget.allocateCollectionEntries(0);
  if (source === undefined || source === null) return collection;
  const iterator = getSandboxIterator(source, budget, context);
  if (iterator === undefined) throw new TypeError(`${name} constructor requires an iterable.`);
  let entry: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [
    source,
    iterator.retainedValue,
    collection,
    entry,
    failure,
    ...(retainedValues?.() ?? [])
  ]);
  const checkData = createDataCheckpoint(budget, context);
  const closeOnThrow = (error: unknown): never | Promise<never> => {
    failure = isCapturedException(error) ? error.reason : error;
    const rethrow = (closeError?: unknown): never => {
      if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError;
      throw error;
    };
    try {
      const closing = iterator.return?.();
      if (iterator.generator || iterator.asynchronous)
        return Promise.resolve(closing).then(() => {
          throw error;
        }, rethrow);
    } catch (closeError) {
      return rethrow(closeError);
    }
    throw error;
  };
  const consume = (result: IteratorResult<SandboxValue>): boolean | Promise<boolean> => {
    if (typeof result !== "object" || result === null)
      throw new TypeError("Iterator result must be an object.");
    if (result.done) return true;
    entry = result.value;
    try {
      budget.visitNode();
      const growth = append(entry);
      if (growth instanceof Promise)
        return growth
          .then((size) => {
            entry = undefined;
            checkData(collection, size);
            return false;
          })
          .catch(closeOnThrow);
      entry = undefined;
      checkData(collection, growth);
    } catch (error) {
      return closeOnThrow(error);
    }
    return false;
  };
  if (iterator.generator || iterator.asynchronous || context !== undefined) {
    return (async () => {
      try {
        checkData(collection, 0, true);
        while (!(await consume(await iterator.next()))) {
          /* Consume each entry before advancing. */
        }
        checkData(collection, 0, true);
        return collection;
      } finally {
        budget.setRetainedValues(retained, undefined);
      }
    })();
  }
  try {
    checkData(collection, 0, true);
    while (!consume(iterator.next() as IteratorResult<SandboxValue>)) {
      /* Synchronous inputs stay synchronous. */
    }
    checkData(collection, 0, true);
    return collection;
  } finally {
    budget.setRetainedValues(retained, undefined);
  }
}
