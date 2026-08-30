import type { Budget } from "../budget.js";
import { getSandboxIterator } from "../iteration.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxSet,
  isSandboxMap,
  isSandboxSet,
  type SandboxClosure,
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
    construct: ([source]) => {
      const entries = getMapEntries(source);
      if (entries instanceof Promise) {
        return entries.then((resolved) => createBudgetedMap(resolved, options.budget));
      }
      return createBudgetedMap(entries, options.budget);
    },
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

function getMapEntries(
  source: SandboxValue
):
  | Array<readonly [SandboxValue, SandboxValue]>
  | Promise<Array<readonly [SandboxValue, SandboxValue]>> {
  if (source === undefined) {
    return [];
  }

  if (isSandboxMap(source)) {
    return [...source.entries];
  }

  if (Array.isArray(source)) {
    return validateMapEntries(source);
  }
  const iterator = getSandboxIterator(source);
  if (iterator?.generator !== true) {
    throw new TypeError("Map constructor argument must be an array of pairs or a Map.");
  }
  return collectMapEntries(iterator);
}

async function collectMapEntries(iterator: NonNullable<ReturnType<typeof getSandboxIterator>>) {
  const sourceEntries: SandboxValue[] = [];
  while (true) {
    const result = await iterator.next();
    if (result.done) break;
    sourceEntries.push(result.value);
  }
  return validateMapEntries(sourceEntries);
}

function validateMapEntries(sourceEntries: SandboxValue[]) {
  return sourceEntries.map((entry) => {
    if (!Array.isArray(entry)) {
      throw new TypeError("Map constructor entries must be arrays.");
    }
    return [entry[0], entry[1]] as const;
  });
}

function getSetValues(source: SandboxValue): SandboxValue[] | Promise<SandboxValue[]> {
  if (source === undefined) {
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

function createBudgetedMap(entries: Array<readonly [SandboxValue, SandboxValue]>, budget: Budget) {
  const map = createSandboxMap(entries);
  budget.allocateCollectionEntries(map.entries.size);
  return map;
}

function createBudgetedSet(values: SandboxValue[], budget: Budget) {
  budget.allocateCollectionEntries(new Set(values).size);
  return createSandboxSet(values);
}
