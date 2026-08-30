import type { Budget } from "../budget.js";
import { isFloat32Array } from "../float32.js";
import { setFloat32Member } from "./float32array.js";
import { getSandboxIterator } from "../iteration.js";
import { sandboxString } from "../string-coercion.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  isSandboxSet,
  type SandboxArray,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";

export type ObjectArrayGlobals = {
  Object: SandboxObject;
  Array: SandboxClosure;
  String: SandboxClosure;
  Number: SandboxClosure;
  Boolean: SandboxClosure;
};

export function createObjectArrayGlobals(options: { budget: Budget }): ObjectArrayGlobals {
  return {
    Object: {
      keys: createSandboxClosure({
        sandbox: true,
        call: ([value]) => budgetSandboxValue(getOwnEnumerableKeys(value), options.budget),
        name: "keys"
      }),
      values: createSandboxClosure({
        sandbox: true,
        call: ([value]) =>
          allocateProducedSandboxValue(getOwnEnumerableValues(value), options.budget),
        name: "values"
      }),
      entries: createSandboxClosure({
        sandbox: true,
        call: ([value]) =>
          allocateProducedSandboxValue(getOwnEnumerableEntries(value), options.budget),
        name: "entries"
      }),
      hasOwn: createSandboxClosure({
        sandbox: true,
        call: ([value, key]) => Reflect.apply(Object.hasOwn, Object, [value, key]),
        name: "hasOwn"
      }),
      is: createSandboxClosure({
        sandbox: true,
        call: ([left, right]) => Reflect.apply(Object.is, Object, [left, right]),
        name: "is"
      }),
      fromEntries: createSandboxClosure({
        sandbox: true,
        call: ([value]) => {
          const iterator = getSandboxIterator(value);
          if (iterator === undefined) {
            throw new TypeError("Object.fromEntries requires an iterable.");
          }
          if (!iterator.generator) {
            return allocateProducedSandboxValue(
              Object.setPrototypeOf(
                Reflect.apply(Object.fromEntries, Object, [{ [Symbol.iterator]: () => iterator }]),
                null
              ),
              options.budget
            );
          }
          return objectFromSandboxEntries(iterator, options.budget);
        },
        name: "fromEntries"
      }),
      freeze: createSandboxClosure({
        sandbox: true,
        call: ([value]) => {
          if (typeof value === "object" && value !== null) {
            Object.freeze(value);
          }

          return value;
        },
        name: "freeze"
      }),
      isFrozen: createSandboxClosure({
        sandbox: true,
        call: ([value]) => Object.isFrozen(value),
        name: "isFrozen"
      }),
      assign: createSandboxClosure({
        sandbox: true,
        call: ([target, ...sources]) => assignSandboxValues(target, sources),
        name: "assign"
      })
    },
    Array: createSandboxClosure({
      sandbox: true,
      call: (args) => createArrayFromConstructorArgs(args, options.budget),
      construct: (args) => createArrayFromConstructorArgs(args, options.budget),
      name: "Array",
      properties: {
        isArray: createSandboxClosure({
          sandbox: true,
          call: ([value]) => Array.isArray(value),
          name: "isArray"
        }),
        from: createSandboxClosure({
          sandbox: true,
          call: (args) => arrayFromSandboxValues(args, options.budget),
          name: "from"
        }),
        of: createSandboxClosure({
          sandbox: true,
          call: (args) =>
            budgetSandboxValue(Reflect.apply(Array.of, Array, [...args]), options.budget),
          name: "of"
        })
      }
    }),
    String: createSandboxClosure({
      sandbox: true,
      call: (args, context) =>
        sandboxString(args.length === 0 ? "" : args[0], options.budget, context),
      name: "String",
      properties: {
        raw: createSandboxClosure({
          sandbox: true,
          call: (args) => stringRaw(args, options.budget),
          name: "raw"
        }),
        fromCharCode: createSandboxClosure({
          sandbox: true,
          call: (args) =>
            options.budget.allocateString(Reflect.apply(String.fromCharCode, String, [...args])),
          name: "fromCharCode"
        }),
        fromCodePoint: createSandboxClosure({
          sandbox: true,
          call: (args) =>
            options.budget.allocateString(Reflect.apply(String.fromCodePoint, String, [...args])),
          name: "fromCodePoint"
        })
      }
    }),
    Number: createSandboxClosure({
      sandbox: true,
      call: ([value]) => Number(value),
      name: "Number",
      properties: {
        isFinite: createSandboxClosure({
          sandbox: true,
          call: ([value]) => typeof value === "number" && Number.isFinite(value),
          name: "isFinite"
        }),
        isNaN: createSandboxClosure({
          sandbox: true,
          call: ([value]) => typeof value === "number" && Number.isNaN(value),
          name: "isNaN"
        }),
        isInteger: createSandboxClosure({
          sandbox: true,
          call: ([value]) => typeof value === "number" && Number.isInteger(value),
          name: "isInteger"
        }),
        parseInt: createSandboxClosure({
          sandbox: true,
          call: (args) => Reflect.apply(Number.parseInt, Number, [...args]),
          name: "parseInt"
        }),
        parseFloat: createSandboxClosure({
          sandbox: true,
          call: (args) => Reflect.apply(Number.parseFloat, Number, [...args]),
          name: "parseFloat"
        }),
        isSafeInteger: createSandboxClosure({
          sandbox: true,
          call: ([value]) => typeof value === "number" && Number.isSafeInteger(value),
          name: "isSafeInteger"
        }),
        MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
        MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
        EPSILON: Number.EPSILON,
        MAX_VALUE: Number.MAX_VALUE,
        MIN_VALUE: Number.MIN_VALUE,
        NaN: Number.NaN,
        NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
        POSITIVE_INFINITY: Number.POSITIVE_INFINITY
      }
    }),
    Boolean: createSandboxClosure({
      sandbox: true,
      call: ([value]) => Boolean(value),
      name: "Boolean"
    })
  };
}

async function objectFromSandboxEntries(
  iterator: NonNullable<ReturnType<typeof getSandboxIterator>>,
  budget: Budget
): Promise<SandboxValue> {
  const object = Object.create(null) as SandboxObject;
  try {
    while (true) {
      const result = await iterator.next();
      if ((typeof result !== "object" && typeof result !== "function") || result === null) {
        throw new TypeError("Iterator result must be an object.");
      }
      if (result.done) break;
      const entry = result.value;
      if ((typeof entry !== "object" && typeof entry !== "function") || entry === null) {
        throw new TypeError("Object.fromEntries requires entry objects.");
      }
      const key = (entry as SandboxObject)[0];
      const value = (entry as SandboxObject)[1];
      Object.defineProperty(object, key as PropertyKey, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }
  } catch (error) {
    try {
      await iterator.return?.();
    } catch {
      throw error;
    }
    throw error;
  }
  return allocateProducedSandboxValue(object, budget);
}

function assignSandboxValues(target: SandboxValue, sources: readonly SandboxValue[]): SandboxValue {
  if (target === null || target === undefined) {
    throw new TypeError("Object.assign(target, ...sources) requires a non-null target.");
  }

  if (!isAssignableSandboxTarget(target)) {
    throw new TypeError("Object.assign(target, ...sources) requires an object or array target.");
  }

  for (const source of sources) {
    if (source === null || source === undefined) {
      continue;
    }

    for (const [key, value] of getOwnEnumerableEntries(source)) {
      if (isFloat32Array(target)) {
        setFloat32Member(target, key, value);
        continue;
      }
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }
  }

  return target;
}

function isAssignableSandboxTarget(
  value: SandboxValue
): value is
  | (SandboxObject & Record<string, SandboxValue>)
  | (SandboxValue[] & Record<string, SandboxValue>) {
  return (
    typeof value === "object" &&
    value !== null &&
    !isSandboxClosure(value) &&
    !isSandboxMap(value) &&
    !isSandboxSet(value) &&
    !isSandboxPromise(value) &&
    !isSandboxRegex(value)
  );
}

async function arrayFromSandboxValues(
  args: readonly SandboxValue[],
  budget: Budget
): Promise<SandboxValue> {
  const [items, mapFn, thisValue] = args;

  const iterator = getSandboxIterator(items);
  const values =
    iterator === undefined
      ? (Reflect.apply(Array.from, Array, [items]) as SandboxValue[])
      : await collectIteratorValues(iterator);
  if (mapFn === undefined || !isSandboxClosure(mapFn)) {
    if (mapFn !== undefined) {
      throw new TypeError("Array.from mapping callback must be a function.");
    }

    return budgetSandboxValue(values, budget);
  }
  const mappedValues: SandboxValue[] = [];

  for (const [index, value] of values.entries()) {
    const result = await mapFn.call([value, index], { stack: [], thisValue });
    if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
      await result.synchronousPrefix;
    }
    mappedValues.push(result);
  }

  return budgetSandboxValue(mappedValues, budget);
}

function createArrayFromConstructorArgs(
  args: readonly SandboxValue[],
  budget: Budget
): SandboxArray {
  if (args.length !== 1) {
    return budgetSandboxValue(Reflect.apply(Array, Array, [...args]), budget) as SandboxArray;
  }

  const [lengthOrValue] = args;
  if (typeof lengthOrValue !== "number") {
    return budgetSandboxValue([lengthOrValue], budget) as SandboxArray;
  }

  if (!Number.isInteger(lengthOrValue) || lengthOrValue < 0 || lengthOrValue > 0xffffffff) {
    throw new RangeError("Invalid array length.");
  }

  budget.allocateArrayLength(lengthOrValue);
  return new Array(lengthOrValue) as SandboxArray;
}

async function collectIteratorValues(
  iterator: NonNullable<ReturnType<typeof getSandboxIterator>>
): Promise<SandboxValue[]> {
  const values: SandboxValue[] = [];
  while (true) {
    const result = await iterator.next();
    if (result.done) return values;
    values.push(result.value);
  }
}

function getOwnEnumerableKeys(value: SandboxValue): string[] {
  return getOwnEnumerableEntries(value).map(([key]) => key);
}

function getOwnEnumerableValues(value: SandboxValue): SandboxValue[] {
  return getOwnEnumerableEntries(value).map(([, entryValue]) => entryValue);
}

function getOwnEnumerableEntries(value: SandboxValue): Array<[string, SandboxValue]> {
  if (value === null || value === undefined) {
    throw new TypeError("Cannot convert undefined or null to object.");
  }

  if (
    isSandboxClosure(value) ||
    isSandboxMap(value) ||
    isSandboxSet(value) ||
    isSandboxPromise(value) ||
    isSandboxRegex(value)
  ) {
    return [];
  }

  return Object.entries(Object(value)) as Array<[string, SandboxValue]>;
}

function budgetSandboxValue(value: unknown, budget: Budget): SandboxValue {
  const sandboxValue = deepCopyToSandbox(value);

  return allocateProducedSandboxValue(sandboxValue, budget);
}

function stringRaw(args: readonly SandboxValue[], budget: Budget): string {
  const [template, ...substitutions] = args;
  const raw = getTemplateRawParts(template);

  let result = "";
  for (let index = 0; index < raw.length; index += 1) {
    result += String(raw[index]);
    if (index < raw.length - 1 && index < substitutions.length) {
      result += String(substitutions[index]);
    }
  }

  return budget.allocateString(result);
}

function getTemplateRawParts(template: SandboxValue): SandboxArray {
  const raw =
    typeof template === "object" && template !== null
      ? (template as Record<string, SandboxValue>).raw
      : undefined;

  if (
    typeof template !== "object" ||
    template === null ||
    isSandboxClosure(template) ||
    isSandboxPromise(template) ||
    !Array.isArray(raw)
  ) {
    throw new TypeError("String.raw requires a raw strings array.");
  }

  return raw;
}
