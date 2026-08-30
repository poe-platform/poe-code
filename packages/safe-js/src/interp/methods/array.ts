import { Budget } from "../budget.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  isSandboxMap,
  isSandboxPromise,
  isSandboxSet,
  type SandboxArray,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import { assertCollectionMutable, enterRunningState } from "../running-state.js";

const activeArrayCallbacks = new WeakMap<SandboxArray, { depth: number; leave: () => void }>();

export type ArrayMethodName =
  | "map"
  | "filter"
  | "find"
  | "findIndex"
  | "findLast"
  | "findLastIndex"
  | "some"
  | "every"
  | "reduce"
  | "reduceRight"
  | "forEach"
  | "flatMap"
  | "flat"
  | "includes"
  | "indexOf"
  | "lastIndexOf"
  | "join"
  | "slice"
  | "concat"
  | "splice"
  | "fill"
  | "copyWithin"
  | "at"
  | "sort"
  | "reverse"
  | "toSorted"
  | "toReversed"
  | "toSpliced"
  | "with"
  | "push"
  | "pop"
  | "shift"
  | "unshift";

export type ArrayMethodOptions = {
  budget: Budget;
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    stack: readonly string[],
    thisValue?: SandboxValue
  ) => Promise<SandboxValue>;
};

const arrayMethodNames = new Set<ArrayMethodName>([
  "map",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
  "forEach",
  "flatMap",
  "flat",
  "includes",
  "indexOf",
  "lastIndexOf",
  "join",
  "slice",
  "concat",
  "splice",
  "fill",
  "copyWithin",
  "at",
  "sort",
  "reverse",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
  "push",
  "pop",
  "shift",
  "unshift"
]);

export function getArrayMember(
  value: SandboxArray,
  property: string | number,
  options: ArrayMethodOptions
): SandboxValue | undefined {
  const index = getArrayIndex(property);
  if (index !== undefined) {
    return Object.hasOwn(value, index) ? value[index] : undefined;
  }

  if (property === "length") {
    return value.length;
  }

  if (Object.hasOwn(value, property)) {
    return (value as unknown as Record<string, SandboxValue>)[String(property)];
  }

  if (isArrayMethodName(property)) {
    return createSandboxClosure({
      sandbox: true,
      name: `Array#${property}`,
      call: (args, context) => callArrayMethod(value, property, args, options, context?.stack ?? [])
    });
  }

  return undefined;
}

function getArrayIndex(property: string | number): number | undefined {
  const index = typeof property === "number" ? property : Number(property);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= 2 ** 32 - 1 ||
    String(index) !== String(property)
  ) {
    return undefined;
  }

  return index;
}

export function isArrayMethodName(property: string | number): property is ArrayMethodName {
  return typeof property === "string" && arrayMethodNames.has(property as ArrayMethodName);
}

export async function callArrayMethod(
  value: SandboxArray,
  methodName: ArrayMethodName,
  args: readonly SandboxValue[],
  options: ArrayMethodOptions,
  stack: readonly string[] = []
): Promise<SandboxValue> {
  if (isMutatingArrayMethod(methodName)) {
    assertCollectionMutable(value);
  }

  if (isCallbackArrayMethod(methodName)) {
    let callbackState = activeArrayCallbacks.get(value);
    if (callbackState === undefined) {
      callbackState = { depth: 0, leave: enterRunningState(value) };
      activeArrayCallbacks.set(value, callbackState);
    }
    callbackState.depth += 1;
    try {
      return await callArrayMethodUnlocked(value, methodName, args, options, stack);
    } finally {
      callbackState.depth -= 1;
      if (callbackState.depth === 0) {
        activeArrayCallbacks.delete(value);
        callbackState.leave();
      }
    }
  }

  return callArrayMethodUnlocked(value, methodName, args, options, stack);
}

async function callArrayMethodUnlocked(
  value: SandboxArray,
  methodName: ArrayMethodName,
  args: readonly SandboxValue[],
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> {
  switch (methodName) {
    case "map":
      return budgetProducedValue(
        await mapArray(value, getRequiredCallback(methodName, args[0]), options, stack, args[1]),
        options.budget
      );
    case "filter":
      return budgetProducedValue(
        await filterArray(value, getRequiredCallback(methodName, args[0]), options, stack, args[1]),
        options.budget
      );
    case "find":
      return budgetProducedValue(
        await findInArray(value, getRequiredCallback(methodName, args[0]), options, stack, args[1]),
        options.budget
      );
    case "findIndex":
      return await findIndexInArray(
        value,
        getRequiredCallback(methodName, args[0]),
        options,
        stack,
        args[1]
      );
    case "findLast":
      return budgetProducedValue(
        await findLastInArray(
          value,
          getRequiredCallback(methodName, args[0]),
          options,
          stack,
          args[1]
        ),
        options.budget
      );
    case "findLastIndex":
      return await findLastIndexInArray(
        value,
        getRequiredCallback(methodName, args[0]),
        options,
        stack,
        args[1]
      );
    case "some":
      return await someInArray(
        value,
        getRequiredCallback(methodName, args[0]),
        options,
        stack,
        args[1]
      );
    case "every":
      return await everyInArray(
        value,
        getRequiredCallback(methodName, args[0]),
        options,
        stack,
        args[1]
      );
    case "reduce":
      return budgetProducedValue(
        await reduceArray(
          value,
          getRequiredCallback(methodName, args[0]),
          args.length > 1,
          args[1],
          options,
          stack
        ),
        options.budget
      );
    case "reduceRight":
      return budgetProducedValue(
        await reduceRightArray(
          value,
          getRequiredCallback(methodName, args[0]),
          args.length > 1,
          args[1],
          options,
          stack
        ),
        options.budget
      );
    case "forEach":
      await forEachArray(value, getRequiredCallback(methodName, args[0]), options, stack, args[1]);
      return undefined;
    case "flatMap":
      return budgetProducedValue(
        await flatMapArray(
          value,
          getRequiredCallback(methodName, args[0]),
          options,
          stack,
          args[1]
        ),
        options.budget
      );
    case "flat":
      return budgetProducedValue(
        flattenArray(value, toIntegerOrInfinity(args[0] ?? 1), options.budget),
        options.budget
      );
    case "includes":
      return Reflect.apply(Array.prototype.includes, value, [...args]);
    case "indexOf":
      return Reflect.apply(Array.prototype.indexOf, value, [...args]);
    case "lastIndexOf":
      return Reflect.apply(Array.prototype.lastIndexOf, value, [...args]);
    case "join":
      return options.budget.allocateString(Reflect.apply(Array.prototype.join, value, [...args]));
    case "slice":
      return budgetProducedValue(
        Reflect.apply(Array.prototype.slice, value, [...args]),
        options.budget
      );
    case "concat":
      return budgetProducedValue(
        Reflect.apply(Array.prototype.concat, value, [...args]),
        options.budget
      );
    case "splice": {
      const removed = Reflect.apply(Array.prototype.splice, value, [...args]);
      budgetProducedValue(removed, options.budget);
      budgetProducedValue(value, options.budget);
      return removed;
    }
    case "fill":
      Reflect.apply(Array.prototype.fill, value, [...args]);
      budgetProducedValue(value, options.budget);
      return value;
    case "copyWithin":
      Reflect.apply(Array.prototype.copyWithin, value, [...args]);
      budgetProducedValue(value, options.budget);
      return value;
    case "at":
      return budgetProducedValue(
        Reflect.apply(Array.prototype.at, value, [...args]),
        options.budget
      );
    case "sort":
      if (args[0] === undefined) {
        value.sort();
        budgetProducedValue(value, options.budget);
        return value;
      }

      await sortArray(value, getRequiredCallback(methodName, args[0]), options, stack);
      budgetProducedValue(value, options.budget);
      return value;
    case "reverse":
      value.reverse();
      budgetProducedValue(value, options.budget);
      return value;
    case "toSorted": {
      const result = Array.from(value) as SandboxArray;
      if (args[0] === undefined) {
        result.sort();
      } else {
        await sortArray(result, getRequiredCallback(methodName, args[0]), options, stack);
      }

      return budgetProducedValue(result, options.budget);
    }
    case "toReversed": {
      const result = Array.from(value) as SandboxArray;
      result.reverse();
      return budgetProducedValue(result, options.budget);
    }
    case "toSpliced": {
      const result = Array.from(value) as SandboxArray;
      Reflect.apply(Array.prototype.splice, result, [...args]);
      return budgetProducedValue(result, options.budget);
    }
    case "with": {
      const result = Array.from(value) as SandboxArray;
      const index = toIntegerOrInfinity(args[0]);
      const actualIndex = index < 0 ? result.length + index : index;

      if (actualIndex < 0 || actualIndex >= result.length) {
        throw new RangeError("Invalid index");
      }

      result[actualIndex] = args[1];
      return budgetProducedValue(result, options.budget);
    }
    case "push": {
      appendArrayValues(value, args);
      const nextLength = value.length;
      budgetProducedValue(value, options.budget);
      return nextLength;
    }
    case "pop":
      return budgetProducedValue(value.pop(), options.budget);
    case "shift":
      return budgetProducedValue(value.shift(), options.budget);
    case "unshift": {
      prependArrayValues(value, args);
      const nextLength = value.length;
      budgetProducedValue(value, options.budget);
      return nextLength;
    }
  }
}

function appendArrayValues(target: SandboxArray, values: readonly SandboxValue[]): void {
  for (const value of values) {
    target.push(value);
  }
}

function prependArrayValues(target: SandboxArray, values: readonly SandboxValue[]): void {
  const originalLength = target.length;
  target.length = originalLength + values.length;

  for (let index = originalLength - 1; index >= 0; index -= 1) {
    const targetIndex = index + values.length;
    if (Object.hasOwn(target, index)) {
      target[targetIndex] = target[index];
    } else {
      delete target[targetIndex];
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    target[index] = values[index];
  }
}

function isCallbackArrayMethod(methodName: ArrayMethodName): boolean {
  return (
    methodName === "map" ||
    methodName === "filter" ||
    methodName === "find" ||
    methodName === "findIndex" ||
    methodName === "findLast" ||
    methodName === "findLastIndex" ||
    methodName === "some" ||
    methodName === "every" ||
    methodName === "reduce" ||
    methodName === "reduceRight" ||
    methodName === "forEach" ||
    methodName === "flatMap" ||
    methodName === "sort"
  );
}

function isMutatingArrayMethod(methodName: ArrayMethodName): boolean {
  return (
    methodName === "splice" ||
    methodName === "fill" ||
    methodName === "copyWithin" ||
    methodName === "sort" ||
    methodName === "reverse" ||
    methodName === "push" ||
    methodName === "pop" ||
    methodName === "shift" ||
    methodName === "unshift"
  );
}

function getRequiredCallback(
  methodName: ArrayMethodName,
  value: SandboxValue | undefined
): SandboxClosure {
  if (!isSandboxClosure(value)) {
    throw new TypeError(`Array#${methodName} requires a sandbox closure callback.`);
  }

  return value;
}

async function mapArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<SandboxArray> {
  const length = value.length;
  const result = new Array(length) as SandboxArray;
  options.budget.setRetainedValues(result, () => [result]);

  try {
    for (let index = 0; index < length; index += 1) {
      options.budget.visitNode();
      if (!(index in value)) {
        continue;
      }

      result[index] = await callArrayCallback(
        callback,
        value[index],
        index,
        value,
        options,
        stack,
        thisValue
      );
    }

    return result;
  } finally {
    options.budget.setRetainedValues(result, undefined);
  }
}

async function filterArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<SandboxArray> {
  const length = value.length;
  const result: SandboxArray = [];
  options.budget.setRetainedValues(result, () => [result]);

  try {
    for (let index = 0; index < length; index += 1) {
      options.budget.visitNode();
      if (!(index in value)) {
        continue;
      }

      const entry = value[index];
      if (await callArrayCallback(callback, entry, index, value, options, stack, thisValue)) {
        result.push(entry);
      }
    }

    return result;
  } finally {
    options.budget.setRetainedValues(result, undefined);
  }
}

async function findInArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<SandboxValue> {
  const length = value.length;

  for (let index = 0; index < length; index += 1) {
    options.budget.visitNode();
    const entry = index in value ? value[index] : undefined;
    if (await callArrayCallback(callback, entry, index, value, options, stack, thisValue)) {
      return entry;
    }
  }

  return undefined;
}

async function findIndexInArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<number> {
  const length = value.length;

  for (let index = 0; index < length; index += 1) {
    options.budget.visitNode();
    const entry = index in value ? value[index] : undefined;
    if (await callArrayCallback(callback, entry, index, value, options, stack, thisValue)) {
      return index;
    }
  }

  return -1;
}

async function findLastInArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<SandboxValue> {
  const length = value.length;

  for (let index = length - 1; index >= 0; index -= 1) {
    options.budget.visitNode();
    const entry = index in value ? value[index] : undefined;
    if (await callArrayCallback(callback, entry, index, value, options, stack, thisValue)) {
      return entry;
    }
  }

  return undefined;
}

async function findLastIndexInArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<number> {
  const length = value.length;

  for (let index = length - 1; index >= 0; index -= 1) {
    options.budget.visitNode();
    const entry = index in value ? value[index] : undefined;
    if (await callArrayCallback(callback, entry, index, value, options, stack, thisValue)) {
      return index;
    }
  }

  return -1;
}

async function someInArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<boolean> {
  const length = value.length;

  for (let index = 0; index < length; index += 1) {
    options.budget.visitNode();
    if (!(index in value)) {
      continue;
    }

    if (await callArrayCallback(callback, value[index], index, value, options, stack, thisValue)) {
      return true;
    }
  }

  return false;
}

async function everyInArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<boolean> {
  const length = value.length;

  for (let index = 0; index < length; index += 1) {
    options.budget.visitNode();
    if (!(index in value)) {
      continue;
    }

    if (
      !(await callArrayCallback(callback, value[index], index, value, options, stack, thisValue))
    ) {
      return false;
    }
  }

  return true;
}

async function reduceArray(
  value: SandboxArray,
  callback: SandboxClosure,
  hasInitialValue: boolean,
  initialValue: SandboxValue | undefined,
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> {
  const length = value.length;

  if (hasInitialValue) {
    return reduceFromLeft(value, callback, initialValue, 0, length, options, stack);
  }

  const start = findNextDefinedIndex(value, 0, 1, length, options.budget);
  if (start < 0) {
    throw new TypeError("Reduce of empty array with no initial value.");
  }

  return reduceFromLeft(value, callback, value[start], start + 1, length, options, stack);
}

async function reduceRightArray(
  value: SandboxArray,
  callback: SandboxClosure,
  hasInitialValue: boolean,
  initialValue: SandboxValue | undefined,
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> {
  const length = value.length;

  if (hasInitialValue) {
    return reduceFromRight(value, callback, initialValue, length - 1, length, options, stack);
  }

  const start = findNextDefinedIndex(value, length - 1, -1, length, options.budget);
  if (start < 0) {
    throw new TypeError("Reduce of empty array with no initial value.");
  }

  return reduceFromRight(value, callback, value[start], start - 1, length, options, stack);
}

async function reduceFromLeft(
  value: SandboxArray,
  callback: SandboxClosure,
  accumulator: SandboxValue,
  startIndex: number,
  length: number,
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> {
  let current = accumulator;
  const retainedAccumulator = {};
  options.budget.setRetainedValues(retainedAccumulator, () => [current]);

  try {
    for (let index = startIndex; index < length; index += 1) {
      options.budget.visitNode();
      if (!(index in value)) {
        continue;
      }

      current = await options.callClosure(callback, [current, value[index], index, value], stack);
    }

    return current;
  } finally {
    options.budget.setRetainedValues(retainedAccumulator, undefined);
  }
}

async function reduceFromRight(
  value: SandboxArray,
  callback: SandboxClosure,
  accumulator: SandboxValue,
  startIndex: number,
  length: number,
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> {
  let current = accumulator;
  const retainedAccumulator = {};
  options.budget.setRetainedValues(retainedAccumulator, () => [current]);

  try {
    for (let index = Math.min(startIndex, length - 1); index >= 0; index -= 1) {
      options.budget.visitNode();
      if (!(index in value)) {
        continue;
      }

      current = await options.callClosure(callback, [current, value[index], index, value], stack);
    }

    return current;
  } finally {
    options.budget.setRetainedValues(retainedAccumulator, undefined);
  }
}

async function forEachArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<void> {
  const length = value.length;

  for (let index = 0; index < length; index += 1) {
    options.budget.visitNode();
    if (!(index in value)) {
      continue;
    }

    await callArrayCallback(callback, value[index], index, value, options, stack, thisValue);
  }
}

async function flatMapArray(
  value: SandboxArray,
  callback: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<SandboxArray> {
  const length = value.length;
  const result: SandboxArray = [];
  options.budget.setRetainedValues(result, () => [result]);

  try {
    for (let index = 0; index < length; index += 1) {
      options.budget.visitNode();
      if (!(index in value)) {
        continue;
      }

      const mapped = await callArrayCallback(
        callback,
        value[index],
        index,
        value,
        options,
        stack,
        thisValue
      );
      if (Array.isArray(mapped)) {
        for (let mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
          options.budget.visitNode();
          if (!(mappedIndex in mapped)) {
            continue;
          }

          result.push(mapped[mappedIndex]);
          options.budget.allocateArrayLength(result.length);
        }

        continue;
      }

      result.push(mapped);
      options.budget.allocateArrayLength(result.length);
    }

    return result;
  } finally {
    options.budget.setRetainedValues(result, undefined);
  }
}

function flattenArray(value: SandboxArray, depth: number, budget: Budget): SandboxArray {
  const result: SandboxArray = [];
  appendFlattenedEntries(value, depth, result, budget);
  return result;
}

function appendFlattenedEntries(
  value: SandboxArray,
  depth: number,
  result: SandboxArray,
  budget: Budget
): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) {
      continue;
    }

    const entry = value[index];
    if (depth > 0 && Array.isArray(entry)) {
      appendFlattenedEntries(entry, depth - 1, result, budget);
      continue;
    }

    result.push(entry);
    budget.allocateArrayLength(result.length);
  }
}

async function sortArray(
  value: SandboxArray,
  comparator: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<void> {
  const length = value.length;
  const definedValues: SandboxValue[] = [];
  let undefinedCount = 0;
  let currentEntry: SandboxValue;
  options.budget.setRetainedValues(definedValues, () => [definedValues, currentEntry]);

  try {
    for (let index = 0; index < length; index += 1) {
      options.budget.visitNode();
      if (!(index in value)) {
        continue;
      }

      const entry = value[index];
      if (entry === undefined) {
        undefinedCount += 1;
        continue;
      }

      definedValues.push(entry);
    }

    for (let index = 1; index < definedValues.length; index += 1) {
      currentEntry = definedValues[index];
      let cursor = index - 1;

      while (
        cursor >= 0 &&
        (await compareEntries(definedValues[cursor], currentEntry, comparator, options, stack)) > 0
      ) {
        definedValues[cursor + 1] = definedValues[cursor];
        cursor -= 1;
      }

      definedValues[cursor + 1] = currentEntry;
    }
    currentEntry = undefined;

    for (let index = 0; index < definedValues.length; index += 1) {
      value[index] = definedValues[index];
    }

    for (let index = 0; index < undefinedCount; index += 1) {
      value[definedValues.length + index] = undefined;
    }

    for (let index = definedValues.length + undefinedCount; index < length; index += 1) {
      options.budget.visitNode();
      delete value[index];
    }
  } finally {
    options.budget.setRetainedValues(definedValues, undefined);
  }
}

async function compareEntries(
  left: SandboxValue,
  right: SandboxValue,
  comparator: SandboxClosure,
  options: ArrayMethodOptions,
  stack: readonly string[]
): Promise<number> {
  options.budget.visitNode();
  const result = Number(await options.callClosure(comparator, [left, right], stack));
  return Number.isNaN(result) ? 0 : result;
}

async function callArrayCallback(
  callback: SandboxClosure,
  value: SandboxValue,
  index: number,
  array: SandboxArray,
  options: ArrayMethodOptions,
  stack: readonly string[],
  thisValue: SandboxValue
): Promise<SandboxValue> {
  return options.callClosure(callback, [value, index, array], stack, thisValue);
}

function findNextDefinedIndex(
  value: SandboxArray,
  startIndex: number,
  direction: 1 | -1,
  length: number,
  budget: Budget
): number {
  for (let index = startIndex; direction > 0 ? index < length : index >= 0; index += direction) {
    budget.visitNode();
    if (index in value) {
      return index;
    }
  }

  return -1;
}

function budgetProducedValue(value: SandboxValue, budget: Budget): SandboxValue {
  allocateProducedValue(value, budget, new WeakSet());
  return value;
}

function allocateProducedValue(value: SandboxValue, budget: Budget, seen: WeakSet<object>): void {
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
      allocateProducedValue(entry, budget, seen);
    }

    return;
  }

  if (isSandboxMap(value)) {
    budget.allocateCollectionEntries(value.entries.size);
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const [key, entry] of value.entries) {
      allocateProducedValue(key, budget, seen);
      allocateProducedValue(entry, budget, seen);
    }
    return;
  }

  if (isSandboxSet(value)) {
    budget.allocateCollectionEntries(value.values.size);
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const entry of value.values) {
      allocateProducedValue(entry, budget, seen);
    }
    return;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    isSandboxClosure(value) ||
    isSandboxMap(value) ||
    isSandboxSet(value) ||
    isSandboxPromise(value)
  ) {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const entry of Object.values(value)) {
    allocateProducedValue(entry, budget, seen);
  }
}

function toIntegerOrInfinity(value: SandboxValue): number {
  const number = Number(value);

  if (Number.isNaN(number) || Object.is(number, 0) || Object.is(number, -0)) {
    return 0;
  }

  if (!Number.isFinite(number)) {
    return number;
  }

  return Math.trunc(number);
}
