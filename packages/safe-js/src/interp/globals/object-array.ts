import { isFatalSandboxError, type Budget, type CompileOwner } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { isCapturedException } from "../exceptions.js";
import { isSandboxDate } from "../date.js";
import { getDatePrototype } from "./date.js";
import { createObjectGlobal, hasOwnSandboxProperty } from "./object.js";
import { getHostObjectKeys, isGuestHostObject } from "../host-capabilities.js";
import { isFloat32Array } from "../float32.js";
import { setSandboxProperty } from "../interpreter.js";
import { getSandboxIterator } from "../iteration.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { getSandboxDataProperty, getSandboxPrototype, isGuestClosure, markDescriptorObject, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
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
  isSandboxSet,
  measureSandboxData,
  ownEnumerableSandboxEntries as getOwnEnumerableEntries,
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

export function createObjectArrayGlobals(options: { budget: Budget; compileOwner?: CompileOwner }): ObjectArrayGlobals {
  return {
    Object: createObjectGlobal({
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
        call: ([value, key], context) => {
          if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object.");
          const name = sandboxString(key, options.budget, context);
          return typeof name === "string"
            ? hasOwnSandboxProperty(value, name, false)
            : name.then(property => hasOwnSandboxProperty(value, property, false));
        },
        name: "hasOwn"
      }),
      getOwnPropertyDescriptor: createSandboxClosure({
        sandbox: true,
        call: async ([value, key], context) => {
          const descriptor = Object.getOwnPropertyDescriptor(objectProperties(value), await sandboxString(key, options.budget, context));
          if (descriptor !== undefined && !("value" in descriptor)) throw new TypeError("Only data property descriptors are supported.");
          return descriptor === undefined ? undefined : allocateProducedSandboxValue(descriptor as SandboxObject, options.budget);
        },
        name: "getOwnPropertyDescriptor"
      }),
      getOwnPropertyNames: createSandboxClosure({
        sandbox: true,
        call: ([value]) => budgetSandboxValue(Object.getOwnPropertyNames(objectProperties(value)), options.budget),
        name: "getOwnPropertyNames"
      }),
      defineProperty: createSandboxClosure({
        sandbox: true,
        call: async ([value, key, descriptor], context) => {
          defineDataProperty(value, await sandboxString(key, options.budget, context), dataDescriptor(descriptor), options.budget);
          return value;
        },
        name: "defineProperty"
      }),
      defineProperties: createSandboxClosure({
        sandbox: true,
        call: ([value, descriptors]) => {
          const properties = getOwnEnumerableEntries(descriptors).map(([key, descriptor]) => [key, dataDescriptor(descriptor)] as const);
          for (const [key, descriptor] of properties) {
            defineDataProperty(value, key, descriptor, options.budget);
          }
          return value;
        },
        name: "defineProperties"
      }),
      getPrototypeOf: createSandboxClosure({
        sandbox: true,
        call: ([value]) => {
          if (isSandboxDate(value)) return getDatePrototype(value, options.budget, options.compileOwner);
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
        call: ([prototype, descriptors]) => {
          if (prototype !== null) objectProperties(prototype);
          const value = Object.create(null) as SandboxObject;
          setSandboxPrototype(value, prototype as object | null, options.budget);
          if (descriptors !== undefined) {
            const properties = getOwnEnumerableEntries(descriptors).map(([key, descriptor]) => [key, dataDescriptor(descriptor)] as const);
            for (const [key, descriptor] of properties) {
              defineDataProperty(value, key, descriptor, options.budget);
            }
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
          const iterator = getSandboxIterator(value, options.budget);
          if (iterator === undefined) {
            throw new TypeError("Object.fromEntries requires an iterable.");
          }
          if (context === undefined && !iterator.generator) {
            // The direct host adapter preserves synchronous results and native hooks.
            return allocateProducedSandboxValue(
              Object.setPrototypeOf(
                Reflect.apply(Object.fromEntries, Object, [{ [Symbol.iterator]: () => iterator }]),
                null
              ),
              options.budget
            );
          }
          return objectFromSandboxEntries(value, iterator, options.budget, context);
        },
        name: "fromEntries"
      }),
      freeze: createSandboxClosure({
        sandbox: true,
        call: ([value]) => {
          if (isGuestHostObject(value)) throw new TypeError("Live host objects cannot be frozen.");
          if (typeof value === "object" && value !== null) {
            Object.freeze(isGuestClosure(value) ? materializeFunctionProperties(value) : value);
          }

          return value;
        },
        name: "freeze"
      }),
      isFrozen: createSandboxClosure({
        sandbox: true,
        call: ([value]) => Object.isFrozen(isGuestClosure(value) ? materializeFunctionProperties(value) : value),
        name: "isFrozen"
      }),
      assign: createSandboxClosure({
        sandbox: true,
        call: ([target, ...sources]) => assignSandboxValues(target, sources, options.budget),
        name: "assign"
      })
    }, options.budget),
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
      call: (args, context) => sandboxNumber(args.length === 0 ? 0 : args[0], options.budget, context),
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
  items: SandboxValue,
  iterator: NonNullable<ReturnType<typeof getSandboxIterator>>,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  const object = Object.create(null) as SandboxObject;
  let entry: SandboxValue;
  let key: SandboxValue;
  let value: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [items, object, entry, key, value, failure]);
  const checkData = createDataCheckpoint(budget, context);
  const closeOnThrow = async (error: unknown): Promise<never> => {
    failure = isCapturedException(error) ? error.reason : error;
    try {
      await iterator.return?.();
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
      if (result.done) break;
      entry = result.value;
      try {
        if (typeof entry !== "object" || entry === null) {
          throw new TypeError("Object.fromEntries requires entry objects.");
        }
        key = context?.getProperty !== undefined
          ? context.getProperty(entry, 0)
          : getSandboxDataProperty(entry, 0, budget);
        value = context?.getProperty !== undefined
          ? context.getProperty(entry, 1)
          : getSandboxDataProperty(entry, 1, budget);
        const property = await sandboxString(key, budget, context);
        const growth = property.length + 1 +
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

function assignSandboxValues(target: SandboxValue, sources: readonly SandboxValue[], budget: Budget): SandboxValue {
  if (target === null || target === undefined) {
    throw new TypeError("Object.assign(target, ...sources) requires a non-null target.");
  }

  if (!isGuestClosure(target) && !isAssignableSandboxTarget(target)) {
    throw new TypeError("Object.assign(target, ...sources) requires an object or array target.");
  }

  for (const source of sources) {
    if (source === null || source === undefined) {
      continue;
    }

    for (const [key, value] of getOwnEnumerableEntries(source)) {
      setSandboxProperty(target, key, value, budget);
    }
  }

  return target;
}

function objectProperties(value: SandboxValue, mutable = false): SandboxObject | SandboxArray {
  if (isSandboxDate(value)) {
    if (mutable) throw new TypeError("Date own properties and prototypes are not supported.");
    return value as unknown as SandboxObject;
  }
  if (isGuestHostObject(value)) throw new TypeError("Live host object descriptors are not supported.");
  if (isGuestClosure(value)) return materializeFunctionProperties(value);
  if (isSandboxClosure(value)) {
    if (mutable) throw new TypeError("Host function properties are read only.");
    return value.properties ?? Object.create(null) as SandboxObject;
  }
  if (!isAssignableSandboxTarget(value)) throw new TypeError("Expected a sandbox object or function.");
  return value;
}

function dataDescriptor(input: SandboxValue): PropertyDescriptor {
  const source = objectProperties(input);
  const descriptor: PropertyDescriptor = {};
  for (const field of ["get", "set", "value", "writable", "enumerable", "configurable"] as const) {
    const entry = Object.getOwnPropertyDescriptor(source, field);
    if (entry === undefined) continue;
    if (!("value" in entry) || field === "get" || field === "set") {
      throw new TypeError("Only data property descriptors are supported.");
    }
    if (field === "value") descriptor.value = entry.value;
    else descriptor[field] = Boolean(entry.value);
  }
  return descriptor;
}

function defineDataProperty(target: SandboxValue, key: string, descriptor: PropertyDescriptor, budget: Budget): void {
  budget.visitNode();
  if (isFloat32Array(target)) throw new TypeError("Typed array property descriptors are not supported.");
  const properties = objectProperties(target, true);
  if (Array.isArray(properties)) {
    if (key === "length" && "value" in descriptor) budget.allocateArrayLength(Number(descriptor.value));
    else {
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
  const read = (property: string | number) => context?.getProperty !== undefined
    ? context.getProperty(items, property)
    : getSandboxDataProperty(items, property, budget);
  const iterator = getSandboxIterator(items, budget);
  const constructor = context?.thisValue;
  let result: SandboxValue;
  let currentValue: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [items, mapFn, constructor, result, currentValue, failure]);
  const checkData = createDataCheckpoint(budget, context);
  const closeOnThrow = async (error: unknown): Promise<never> => {
    failure = isCapturedException(error) ? error.reason : error;
    try {
      await iterator?.return?.();
    } catch (closeError) {
      if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError;
    }
    throw error;
  };
  try {
    let length = 0;
    if (iterator === undefined) {
      const number = await sandboxNumber(read("length"), budget, context);
      length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
    }
    result = isSandboxClosure(constructor) && constructor.construct !== undefined
      ? await invokeBuiltinClosure(constructor, iterator === undefined ? [length] : [], budget, context, undefined, true)
      : createArrayFromConstructorArgs([length], budget);
    checkData(result, 0, true);

    let index = 0;
    while (iterator !== undefined || index < length) {
      try {
        budget.visitNode();
        if (iterator !== undefined && index >= Number.MAX_SAFE_INTEGER) throw new TypeError("Array.from input is too long.");
      } catch (error) {
        await closeOnThrow(error);
      }
      if (iterator !== undefined) {
        const next = await iterator.next();
        if (typeof next !== "object" || next === null) throw new TypeError("Iterator result must be an object.");
        if (next.done) break;
        currentValue = next.value;
      } else {
        currentValue = read(index);
      }
      try {
        if (Array.isArray(result)) budget.allocateArrayLength(index + 1);
        if (mapFn !== undefined) currentValue = await invokeBuiltinClosure(mapFn, [currentValue, index], budget, context, thisValue);
        const key = String(index);
        const growth = key.length + 1 +
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

function getOwnEnumerableKeys(value: SandboxValue): string[] {
  if (isGuestHostObject(value)) return getHostObjectKeys(value);
  return getOwnEnumerableEntries(value).map(([key]) => key);
}

function getOwnEnumerableValues(value: SandboxValue): SandboxValue[] {
  return getOwnEnumerableEntries(value).map(([, entryValue]) => entryValue);
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
