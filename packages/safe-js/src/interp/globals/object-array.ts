import { isFatalSandboxError, type Budget, type CompileOwner } from "../budget.js";
import { accessorAdapter, accessorClosure, retainedAccessorClosures } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { retainValues } from "../resources.js";
import { isCapturedException } from "../exceptions.js";
import { isSandboxDate } from "../date.js";
import { createSandboxBox } from "../boxed.js";
import { getDatePrototype } from "./date.js";
import { createObjectGlobal, hasOwnSandboxProperty } from "./object.js";
import { isGuestHostObject } from "../host-capabilities.js";
import { isFloat32Array } from "../float32.js";
import { setSandboxProperty } from "../interpreter.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult, type SandboxIterator } from "../iteration.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { toPropertyKey } from "../property-key.js";
import { createNumericParsers } from "./numeric-parsers.js";
import { createPrimitiveConstructor } from "./primitives.js";
import {
  getSandboxDataProperty,
  getSandboxPropertyDescriptor,
  getSandboxPrototype,
  isGuestClosure,
  markDescriptorObject,
  materializeFunctionProperties,
  setSandboxPrototype
} from "../object-model.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  deepCopyToSandbox,
  defineOwnDataProperty,
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  getRegexProperties,
  isSandboxSet,
  measureSandboxData,
  ownEnumerableSandboxKeys as getOwnEnumerableKeys,
  ownSandboxSymbolKeys,
  ownEnumerableSandboxEntries as getDirectEntries,
  type SandboxArray,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";

export type ObjectArrayGlobals = {
  Object: SandboxClosure;
  Array: SandboxClosure;
  String: SandboxClosure;
  Number: SandboxClosure;
  Boolean: SandboxClosure;
};

export function createObjectArrayGlobals(options: {
  budget: Budget;
  compileOwner?: CompileOwner;
}): ObjectArrayGlobals {
  return {
    Object: createObjectGlobal(
      {
        keys: createSandboxClosure({
          sandbox: true,
          call: ([value]) => budgetSandboxValue(getOwnEnumerableKeys(value), options.budget),
          name: "keys"
        }),
        values: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            context === undefined
              ? allocateProducedSandboxValue(
                  getDirectEntries(value).map(([, entry]) => entry),
                  options.budget
                )
              : getOwnEnumerableEntries(value, options.budget, context).then((entries) =>
                  allocateProducedSandboxValue(
                    entries.map(([, entry]) => entry),
                    options.budget
                  )
                ),
          name: "values"
        }),
        entries: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            context === undefined
              ? allocateProducedSandboxValue(getDirectEntries(value), options.budget)
              : getOwnEnumerableEntries(value, options.budget, context).then((entries) =>
                  allocateProducedSandboxValue(entries, options.budget)
                ),
          name: "entries"
        }),
        hasOwn: createSandboxClosure({
          sandbox: true,
          call: ([value, key], context) => {
            if (value === null || value === undefined)
              throw new TypeError("Cannot convert undefined or null to object.");
            const name = toPropertyKey(key, options.budget, context);
            return typeof name === "string" || typeof name === "symbol"
              ? hasOwnSandboxProperty(value, name, false)
              : name.then((property) => hasOwnSandboxProperty(value, property, false));
          },
          name: "hasOwn"
        }),
        getOwnPropertyDescriptor: createSandboxClosure({
          sandbox: true,
          call: async ([value, key], context) => {
            const descriptor = Object.getOwnPropertyDescriptor(
              objectProperties(value),
              await toPropertyKey(key, options.budget, context)
            );
            if (descriptor === undefined) return undefined;
            return allocateProducedSandboxValue(
              exposePropertyDescriptor(descriptor),
              options.budget
            );
          },
          name: "getOwnPropertyDescriptor"
        }),
        getOwnPropertyDescriptors: createSandboxClosure({
          sandbox: true,
          call: ([value]) => {
            const descriptors = Object.create(null) as SandboxObject;
            const properties = objectProperties(value);
            for (const key of [...Object.getOwnPropertyNames(properties), ...ownSandboxSymbolKeys(value)])
              defineOwnDataProperty(descriptors, key, exposePropertyDescriptor(Object.getOwnPropertyDescriptor(properties, key)!));
            return allocateProducedSandboxValue(descriptors, options.budget);
          },
          name: "getOwnPropertyDescriptors"
        }),
        getOwnPropertyNames: createSandboxClosure({
          sandbox: true,
          call: ([value]) =>
            budgetSandboxValue(Object.getOwnPropertyNames(objectProperties(value)), options.budget),
          name: "getOwnPropertyNames"
        }),
        getOwnPropertySymbols: createSandboxClosure({
          sandbox: true,
          call: ([value]) => allocateProducedSandboxValue(ownSandboxSymbolKeys(value), options.budget),
          name: "getOwnPropertySymbols"
        }),
        defineProperty: createSandboxClosure({
          sandbox: true,
          call: async ([value, key, descriptor], context) => {
            objectProperties(value, true);
            const property = await toPropertyKey(key, options.budget, context);
            defineDataProperty(
              value,
              property,
              await propertyDescriptor(descriptor, options.budget, context),
              options.budget
            );
            return value;
          },
          name: "defineProperty"
        }),
        defineProperties: createSandboxClosure({
          sandbox: true,
          call: async ([value, descriptors], context) => {
            await definePropertiesFromObject(value, descriptors, options.budget, context);
            return value;
          },
          name: "defineProperties"
        }),
        getPrototypeOf: createSandboxClosure({
          sandbox: true,
          call: ([value]) => {
            if (isSandboxDate(value))
              return getDatePrototype(value, options.budget, options.compileOwner);
            if (value !== null && value !== undefined && typeof value !== "object")
              value = createSandboxBox(value);
            objectProperties(value);
            return getSandboxPrototype(value as object, options.budget) as SandboxValue;
          },
          name: "getPrototypeOf"
        }),
        setPrototypeOf: createSandboxClosure({
          sandbox: true,
          call: ([value, prototype]) => {
            objectProperties(value, true);
            if (prototype !== null) objectProperties(prototype);
            setSandboxPrototype(value as object, prototype as object | null, options.budget);
            return value;
          },
          name: "setPrototypeOf"
        }),
        create: createSandboxClosure({
          sandbox: true,
          call: async ([prototype, descriptors], context) => {
            if (prototype !== null) objectProperties(prototype);
            const value = Object.create(null) as SandboxObject;
            setSandboxPrototype(value, prototype as object | null, options.budget);
            if (descriptors !== undefined) {
              await definePropertiesFromObject(value, descriptors, options.budget, context);
            }
            return allocateProducedSandboxValue(value, options.budget);
          },
          name: "create"
        }),
        is: createSandboxClosure({
          sandbox: true,
          call: ([left, right]) => Reflect.apply(Object.is, Object, [left, right]),
          name: "is"
        }),
        fromEntries: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            if (context !== undefined) return acquireSandboxIterator(value, options.budget, context).then(iterator => {
              if (iterator === undefined) throw new TypeError("Object.fromEntries requires an iterable.");
              return objectFromSandboxEntries(value, iterator, options.budget, context);
            });
            const iterator = getSandboxIterator(value, options.budget, context);
            if (iterator === undefined) {
              throw new TypeError("Object.fromEntries requires an iterable.");
            }
            if (context === undefined && !iterator.generator && !iterator.asynchronous) {
              // The direct host adapter preserves synchronous results and native hooks.
              return allocateProducedSandboxValue(
                Object.setPrototypeOf(
                  Reflect.apply(Object.fromEntries, Object, [
                    { [Symbol.iterator]: () => iterator }
                  ]),
                  null
                ),
                options.budget
              );
            }
            return objectFromSandboxEntries(value, iterator, options.budget, context);
          },
          name: "fromEntries"
        }),
        preventExtensions: createSandboxClosure({
          sandbox: true,
          call: ([value]) => {
            if (isGuestHostObject(value))
              throw new TypeError("Live host objects cannot be made non-extensible.");
            Object.preventExtensions(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : value);
            return value;
          },
          name: "preventExtensions"
        }),
        isExtensible: createSandboxClosure({
          sandbox: true,
          call: ([value]) =>
            Object.isExtensible(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : value),
          name: "isExtensible"
        }),
        seal: createSandboxClosure({
          sandbox: true,
          call: ([value]) => {
            if (isGuestHostObject(value))
              throw new TypeError("Live host objects cannot be sealed.");
            Object.seal(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : value);
            return value;
          },
          name: "seal"
        }),
        isSealed: createSandboxClosure({
          sandbox: true,
          call: ([value]) =>
            Object.isSealed(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : value),
          name: "isSealed"
        }),
        freeze: createSandboxClosure({
          sandbox: true,
          call: ([value]) => {
            if (isGuestHostObject(value))
              throw new TypeError("Live host objects cannot be frozen.");
            if (typeof value === "object" && value !== null) {
            Object.freeze(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : value);
            }

            return value;
          },
          name: "freeze"
        }),
        isFrozen: createSandboxClosure({
          sandbox: true,
          call: ([value]) =>
            Object.isFrozen(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : value),
          name: "isFrozen"
        }),
        assign: createSandboxClosure({
          sandbox: true,
          call: ([target, ...sources], context) =>
            assignSandboxValues(target, sources, options.budget, context),
          name: "assign"
        })
      },
      options.budget
    ),
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
          call: (args, context) => arrayFromSandboxValues(args, options.budget, context),
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
    String: createPrimitiveConstructor(
      {
        call: (args, context) =>
          typeof args[0] === "symbol"
            ? options.budget.allocateString(String(args[0]))
            : sandboxString(args.length === 0 ? "" : args[0], options.budget, context),
        name: "String",
        properties: {
          raw: createSandboxClosure({
            sandbox: true,
            call: (args, context) => stringRaw(args, options.budget, context),
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
      },
      options.budget
    ),
    Number: createPrimitiveConstructor(
      {
        call: (args, context) =>
          sandboxNumber(args.length === 0 ? 0 : args[0], options.budget, context, true),
        name: "Number",
        properties: {
          isFinite: createSandboxClosure({
            guest: true,
            sandbox: true,
            call: ([value]) => typeof value === "number" && Number.isFinite(value),
            name: "isFinite"
          }),
          isNaN: createSandboxClosure({
            guest: true,
            sandbox: true,
            call: ([value]) => typeof value === "number" && Number.isNaN(value),
            name: "isNaN"
          }),
          isInteger: createSandboxClosure({
            guest: true,
            sandbox: true,
            call: ([value]) => typeof value === "number" && Number.isInteger(value),
            name: "isInteger"
          }),
          ...createNumericParsers(options.budget),
          isSafeInteger: createSandboxClosure({
            guest: true,
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
      },
      options.budget
    ),
    Boolean: createPrimitiveConstructor(
      {
        call: ([value]) => Boolean(value),
        name: "Boolean"
      },
      options.budget
    )
  };
}

async function objectFromSandboxEntries(
  items: SandboxValue,
  iterator: SandboxIterator,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  const object = Object.create(null) as SandboxObject;
  let entry: SandboxValue;
  let key: SandboxValue;
  let value: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [
    items,
    iterator.retainedValue,
    object,
    entry,
    key,
    value,
    failure
  ]);
  const checkData = createDataCheckpoint(budget, context);
  const closeOnThrow = async (error: unknown): Promise<never> => {
    failure = isCapturedException(error) ? error.reason : error;
    try {
      await closeIterator(iterator, true);
    } catch (closeError) {
      if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError;
    }
    throw error;
  };
  try {
    checkData(object, 0, true);
    while (true) {
      try {
        budget.visitNode();
      } catch (error) {
        await closeOnThrow(error);
      }
      const result = await iterator.next();
      if (typeof result !== "object" || result === null) {
        throw new TypeError("Iterator result must be an object.");
      }
      if ((await readIteratorResult(iterator, result, "done")).value) break;
      entry = (await readIteratorResult(iterator, result, "value")).value;
      try {
        if (typeof entry !== "object" || entry === null) {
          throw new TypeError("Object.fromEntries requires entry objects.");
        }
        key =
          context?.getProperty !== undefined
            ? await context.getProperty(entry, 0)
            : getSandboxDataProperty(entry, 0, budget);
        value =
          context?.getProperty !== undefined
            ? await context.getProperty(entry, 1)
            : getSandboxDataProperty(entry, 1, budget);
        const property = await toPropertyKey(key, budget, context);
        const growth =
          (typeof property === "symbol" ? property.description?.length ?? 0 : property.length) +
          1 +
          (budget.limits.dataSize === undefined ? 0 : measureSandboxData([value]));
        budget.visitNode();
        defineOwnDataProperty(object, property, value);
        entry = key = value = undefined;
        checkData(object, growth);
      } catch (error) {
        await closeOnThrow(error);
      }
    }
    checkData(object, 0, true);
    return allocateProducedSandboxValue(object, budget);
  } finally {
    budget.setRetainedValues(retained, undefined);
  }
}

function assignSandboxValues(
  target: SandboxValue,
  sources: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  if (target === null || target === undefined) {
    throw new TypeError("Object.assign(target, ...sources) requires a non-null target.");
  }

  if (typeof target !== "object") {
    target = createSandboxBox(target);
    budget.chargeDataUsage(measureSandboxData([target]));
  }

  if (!isGuestClosure(target) && !isAssignableSandboxTarget(target)) {
    throw new TypeError("Object.assign(target, ...sources) requires an object or array target.");
  }

  if (context === undefined) {
    for (const source of sources) {
      if (source === null || source === undefined) continue;
      for (const [key, value] of getDirectEntries(source))
        setSandboxProperty(target, key, value, budget);
    }
    return target;
  }
  return (async () => {
    const release = retainValues(budget, () => [target, ...sources]);
    try {
      for (const source of sources) {
        if (source === null || source === undefined) continue;
        for (const key of getOwnEnumerableKeys(source)) {
          if (!hasOwnSandboxProperty(source, key, true)) continue;
          const value = await (context.getProperty !== undefined
            ? context.getProperty(source, key)
            : getSandboxDataProperty(source, key, budget));
          await setSandboxProperty(target, key, value, budget, true, context);
        }
      }
      return target;
    } finally {
      release();
    }
  })();
}

function objectProperties(value: SandboxValue, mutable = false): SandboxObject | SandboxArray {
  if (isSandboxRegex(value)) return getRegexProperties(value);
  if (isSandboxDate(value)) {
    return value as unknown as SandboxObject;
  }
  if (isGuestHostObject(value))
    throw new TypeError("Live host object descriptors are not supported.");
  if (isGuestClosure(value)) return materializeFunctionProperties(value);
  if (isSandboxClosure(value)) {
    if (mutable) throw new TypeError("Host function properties are read only.");
    return value.properties ?? (Object.create(null) as SandboxObject);
  }
  if (!isAssignableSandboxTarget(value))
    throw new TypeError("Expected a sandbox object or function.");
  return value;
}

function exposePropertyDescriptor(descriptor: PropertyDescriptor): SandboxObject {
  return (
    "value" in descriptor
      ? descriptor
      : {
          get: accessorClosure(descriptor.get),
          set: accessorClosure(descriptor.set),
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable
        }
  ) as SandboxObject;
}

async function propertyDescriptor(
  input: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<PropertyDescriptor> {
  objectProperties(input);
  const descriptor: PropertyDescriptor = {};
  const release = retainValues(budget, () => [
    input,
    descriptor.value,
    ...retainedAccessorClosures(descriptor)
  ]);
  try {
    for (const field of [
      "enumerable",
      "configurable",
      "value",
      "writable",
      "get",
      "set"
    ] as const) {
      if (
        getSandboxPropertyDescriptor(input, field, budget) === undefined &&
        !hasOwnSandboxProperty(input, field, false)
      )
        continue;
      const value = await (context?.getProperty !== undefined
        ? context.getProperty(input, field)
        : getSandboxDataProperty(input, field, budget));
      if (field === "get" || field === "set") {
        if (value !== undefined && !isSandboxClosure(value))
          throw new TypeError("Accessor must be a function or undefined.");
        descriptor[field] =
          value === undefined ? undefined : (accessorAdapter(value, field) as () => unknown);
      } else if (field === "value") {
        descriptor.value = value;
      } else {
        descriptor[field] = Boolean(value);
      }
    }
    if (
      ("get" in descriptor || "set" in descriptor) &&
      ("value" in descriptor || "writable" in descriptor)
    )
      throw new TypeError("A property cannot be both a data property and an accessor.");
    return descriptor;
  } finally {
    release();
  }
}

async function definePropertiesFromObject(
  target: SandboxValue,
  descriptors: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<void> {
  objectProperties(target, true);
  const properties: Array<[PropertyKey, PropertyDescriptor]> = [];
  const release = retainValues(budget, () => [
    target,
    descriptors,
    properties,
    ...properties.flatMap(([, descriptor]) => retainedAccessorClosures(descriptor))
  ]);
  try {
    for (const key of getOwnEnumerableKeys(descriptors, true)) {
      if (!hasOwnSandboxProperty(descriptors, key, true)) continue;
      const descriptor = await (context?.getProperty !== undefined
        ? context.getProperty(descriptors, key)
        : getSandboxDataProperty(descriptors, key, budget));
      properties.push([key, await propertyDescriptor(descriptor, budget, context)]);
    }
    for (const [key, descriptor] of properties) defineDataProperty(target, key, descriptor, budget);
  } finally {
    release();
  }
}

export function defineDataProperty(
  target: SandboxValue,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  budget: Budget
): void {
  budget.visitNode();
  if (isFloat32Array(target))
    throw new TypeError("Typed array property descriptors are not supported.");
  const properties = objectProperties(target, true);
  if (Array.isArray(properties)) {
    if (key === "length" && "value" in descriptor)
      budget.allocateArrayLength(Number(descriptor.value));
    else if (typeof key !== "symbol") {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key) {
        budget.allocateArrayLength(index + 1);
      }
    }
  }
  Object.defineProperty(properties, key, descriptor);
  markDescriptorObject(properties);
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
    !isSandboxGenerator(value) &&
    !isSandboxMap(value) &&
    !isSandboxSet(value) &&
    !isSandboxPromise(value) &&
    !isSandboxRegex(value)
  );
}

async function arrayFromSandboxValues(
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  const [items, mapFn, thisValue] = args;
  if (mapFn !== undefined && !isSandboxClosure(mapFn)) {
    throw new TypeError("Array.from mapping callback must be a function.");
  }
  if (items === null || items === undefined) {
    throw new TypeError("Array.from requires a non-null input.");
  }
  const read = (property: string | number) =>
    context?.getProperty !== undefined
      ? context.getProperty(items, property)
      : getSandboxDataProperty(items, property, budget);
  const iterator = context === undefined ? getSandboxIterator(items, budget) : await acquireSandboxIterator(items, budget, context);
  const constructor = context?.thisValue;
  let result: SandboxValue;
  let currentValue: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [
    items,
    iterator?.retainedValue,
    mapFn,
    constructor,
    result,
    currentValue,
    failure
  ]);
  const checkData = createDataCheckpoint(budget, context);
  const closeOnThrow = async (error: unknown): Promise<never> => {
    failure = isCapturedException(error) ? error.reason : error;
    try {
      if (iterator !== undefined) await closeIterator(iterator, true);
    } catch (closeError) {
      if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError;
    }
    throw error;
  };
  try {
    let length = 0;
    if (iterator === undefined) {
      const number = await sandboxNumber(await read("length"), budget, context);
      length =
        Number.isNaN(number) || number <= 0
          ? 0
          : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
    }
    result =
      isSandboxClosure(constructor) && constructor.construct !== undefined
        ? await invokeBuiltinClosure(
            constructor,
            iterator === undefined ? [length] : [],
            budget,
            context,
            undefined,
            true
          )
        : createArrayFromConstructorArgs([length], budget);
    checkData(result, 0, true);

    let index = 0;
    while (iterator !== undefined || index < length) {
      try {
        budget.visitNode();
        if (iterator !== undefined && index >= Number.MAX_SAFE_INTEGER)
          throw new TypeError("Array.from input is too long.");
      } catch (error) {
        await closeOnThrow(error);
      }
      if (iterator !== undefined) {
        const next = await iterator.next();
        if (typeof next !== "object" || next === null)
          throw new TypeError("Iterator result must be an object.");
        if ((await readIteratorResult(iterator, next, "done")).value) break;
        currentValue = (await readIteratorResult(iterator, next, "value")).value;
      } else {
        currentValue = await read(index);
      }
      try {
        if (Array.isArray(result)) budget.allocateArrayLength(index + 1);
        if (mapFn !== undefined)
          currentValue = await invokeBuiltinClosure(
            mapFn,
            [currentValue, index],
            budget,
            context,
            thisValue
          );
        const key = String(index);
        const growth =
          key.length +
          1 +
          (Array.isArray(result) ? Math.max(0, index + 1 - result.length) : 0) +
          (budget.limits.dataSize === undefined ? 0 : measureSandboxData([currentValue]));
        budget.visitNode();
        defineOwnDataProperty(objectProperties(result, true), key, currentValue);
        currentValue = undefined;
        checkData(result, growth, isSandboxClosure(result));
      } catch (error) {
        await closeOnThrow(error);
      }
      index += 1;
    }
    setSandboxProperty(result, "length", index, budget);
    checkData(result, 0, true);
    return allocateProducedSandboxValue(result, budget);
  } finally {
    budget.setRetainedValues(retained, undefined);
  }
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
  const release = budget.provisionDataUsage(lengthOrValue + 1);
  try {
    return new Array(lengthOrValue) as SandboxArray;
  } finally {
    release();
  }
}

async function getOwnEnumerableEntries(
  value: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<Array<[string, SandboxValue]>> {
  const entries: Array<[string, SandboxValue]> = [];
  const release = retainValues(budget, () => [value, entries]);
  try {
    for (const key of getOwnEnumerableKeys(value)) {
      if (!hasOwnSandboxProperty(value, key, true)) continue;
      entries.push([
        key,
        await (context?.getProperty !== undefined
          ? context.getProperty(value, key)
          : getSandboxDataProperty(value, key, budget))
      ]);
    }
    return entries;
  } finally {
    release();
  }
}

function budgetSandboxValue(value: unknown, budget: Budget): SandboxValue {
  const sandboxValue = deepCopyToSandbox(value);

  return allocateProducedSandboxValue(sandboxValue, budget);
}

function stringRaw(
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): string | Promise<string> {
  const [template, ...substitutions] = args;
  if (context?.getProperty !== undefined)
    return (async () => {
      if (template === null || template === undefined)
        throw new TypeError("String.raw requires a template object.");
      const raw = await context.getProperty!(template, "raw");
      if (raw === null || raw === undefined)
        throw new TypeError("String.raw requires raw strings.");
      const number = await sandboxNumber(
        await context.getProperty!(raw, "length"),
        budget,
        context
      );
      const length =
        Number.isNaN(number) || number <= 0
          ? 0
          : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
      let result = "";
      const retained = {};
      budget.setRetainedValues(retained, () => [raw, result]);
      try {
        for (let index = 0; index < length; index++) {
          budget.visitNode();
          result = budget.allocateString(
            result + (await sandboxString(await context.getProperty!(raw, index), budget, context))
          );
          if (index + 1 < length && index < substitutions.length)
            result = budget.allocateString(
              result + (await sandboxString(substitutions[index], budget, context))
            );
        }
        return result;
      } finally {
        budget.setRetainedValues(retained, undefined);
      }
    })();
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
