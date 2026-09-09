import { isFatalSandboxError, type Budget, type CompileOwner } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { guestProxyStates } from "../guest-proxy.js";
import { sandboxIsArray } from "../guest-proxy-array.js";
import { sandboxIsExtensible, sandboxPreventExtensions } from "../guest-proxy-extensibility.js";
import { sandboxGetPrototypeOf, sandboxSetPrototypeOf } from "../guest-proxy-prototype.js";
import { sandboxGetOwnPropertyDescriptor } from "../guest-proxy-descriptor.js";
import { sandboxHasProperty } from "../guest-proxy-has.js";
import { sandboxDeleteProperty } from "../guest-proxy-delete.js";
import { sandboxOwnKeys } from "../guest-proxy-own-keys.js";
import { setGuestProxyIntegrity, testGuestProxyIntegrity } from "../guest-proxy-integrity.js";
import { defineGuestProxyProperty } from "../guest-proxy-define.js";
import { getGeneratorProperties } from "../generator-properties.js";
import { accessorAdapter, accessorClosure, readPropertyDescriptor, retainedAccessorClosures } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { awaitSandboxValue } from "../cancel.js";
import { executeAsyncFunction } from "../async.js";
import { suspendJob } from "../jobs.js";
import { restoreSandboxArrayIterator } from "../array-iterator.js";
import { nextArrayIterator } from "../methods/array-iterator.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { retainValues } from "../resources.js";
import { isCapturedException } from "../exceptions.js";
import { isSandboxDate } from "../date.js";
import { createSandboxBox } from "../boxed.js";
import { createObjectGlobal, hasOwnSandboxProperty } from "./object.js";
import { isGuestHostObject } from "../host-capabilities.js";
import { isNumericTypedArray, isTypedArrayIndex, typedArrayStorage } from "../typed-array.js";
import { typedArrayElement } from "./numeric-typed-array.js";
import { setSandboxProperty } from "../interpreter.js";
import { acquireSandboxIterator, closeIterator, getSandboxAsyncIterator, getSandboxIterator, getSandboxIteratorFromMethod, readIteratorResult, type SandboxIterator } from "../iteration.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { toPropertyKey } from "../property-key.js";
import { createGroupBy } from "./group-by.js";
import { createNumericParsers } from "./numeric-parsers.js";
import { createPrimitiveConstructor } from "./primitives.js";
import { arrayMethodLengths, arrayMethodNames, callArrayMethod } from "../methods/array.js";
import {
  createIntrinsicObject,
  getSandboxDataProperty,
  getSandboxPropertyDescriptor,
  getBoxedPrototype,
  getSandboxPrototype,
  installArrayPrototype,
  markDescriptorObject,
  materializeFunctionProperties,
  registerIntrinsicObject,
  registerIntrinsicFunction,
  setSandboxPrototype
} from "../object-model.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  defineOwnDataProperty,
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  getPromiseProperties,
  isSandboxRegex,
  getRegexProperties,
  getCollectionProperties,
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
  numericParsers?: ReturnType<typeof createNumericParsers>;
}): ObjectArrayGlobals {
  return {
    Object: createObjectGlobal(
      {
        keys: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            typeof value === "object" && value !== null && guestProxyStates.has(value)
              ? getOwnEnumerableProperties(value, "key", options.budget, context).then(keys =>
                  allocateReflectionResult(keys, options.budget))
              : allocateReflectionResult(getOwnEnumerableKeys(value), options.budget),
          name: "keys"
        }),
        values: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            context === undefined && !(typeof value === "object" && value !== null && guestProxyStates.has(value))
              ? allocateReflectionResult(
                  getDirectEntries(value).map(([, entry]) => entry),
                  options.budget
                )
              : getOwnEnumerableProperties(value, "value", options.budget, context).then((values) =>
                  allocateReflectionResult(values, options.budget)
                ),
          name: "values"
        }),
        entries: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            context === undefined && !(typeof value === "object" && value !== null && guestProxyStates.has(value))
              ? allocateReflectionResult(getDirectEntries(value), options.budget, true)
              : getOwnEnumerableProperties(value, "key+value", options.budget, context).then((entries) =>
                  allocateReflectionResult(entries, options.budget, true)
                ),
          name: "entries"
        }),
        hasOwn: createSandboxClosure({
          sandbox: true,
          call: ([value, key], context) => {
            if (value === null || value === undefined)
              throw new TypeError("Cannot convert undefined or null to object.");
            const name = toPropertyKey(key, options.budget, context);
            const finish = (property: PropertyKey) => {
              if (typeof value === "object" && guestProxyStates.has(value))
                return Promise.resolve(sandboxGetOwnPropertyDescriptor(value, property, options.budget, context))
                  .then(descriptor => descriptor !== undefined);
              return hasOwnSandboxProperty(value, property, false);
            };
            return typeof name === "string" || typeof name === "symbol"
              ? finish(name)
              : name.then(finish);
          },
          name: "hasOwn"
        }),
        getOwnPropertyDescriptor: createSandboxClosure({
          sandbox: true,
          call: async ([value, key], context) => {
            const properties = reflectionProperties(value);
            const property = await toPropertyKey(key, options.budget, context);
            const descriptor = typeof value === "object" && value !== null && guestProxyStates.has(value)
              ? await sandboxGetOwnPropertyDescriptor(value, property, options.budget, context)
              : Object.getOwnPropertyDescriptor(properties, property);
            if (descriptor === undefined) return undefined;
            return allocateProducedSandboxValue(
              exposePropertyDescriptor(descriptor, options.budget),
              options.budget
            );
          },
          name: "getOwnPropertyDescriptor"
        }),
        getOwnPropertyDescriptors: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            const descriptors = Object.create(null) as SandboxObject;
            const prototype = getSandboxPrototype(descriptors, options.budget);
            if (prototype !== null) setSandboxPrototype(descriptors, prototype, options.budget);
            const properties = reflectionProperties(value);
            if (typeof value === "object" && value !== null && guestProxyStates.has(value)) {
              return (async () => {
                let keys: Array<string | symbol> = [];
                const release = retainValues(options.budget, () => [value, keys, descriptors]);
                try {
                  keys = await sandboxOwnKeys(value, options.budget, context);
                  for (const key of keys) {
                    options.budget.visitNode();
                    const descriptor = await sandboxGetOwnPropertyDescriptor(value, key, options.budget, context);
                    if (descriptor !== undefined)
                      defineOwnDataProperty(descriptors, key, exposePropertyDescriptor(descriptor, options.budget));
                  }
                  return allocateProducedSandboxValue(descriptors, options.budget);
                } finally {
                  release();
                }
              })();
            }
            for (const key of [...Object.getOwnPropertyNames(properties), ...ownSandboxSymbolKeys(value)])
              defineOwnDataProperty(descriptors, key, exposePropertyDescriptor(Object.getOwnPropertyDescriptor(properties, key)!, options.budget));
            return allocateProducedSandboxValue(descriptors, options.budget);
          },
          name: "getOwnPropertyDescriptors"
        }),
        getOwnPropertyNames: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            if (typeof value === "object" && value !== null && guestProxyStates.has(value))
              return Promise.resolve(sandboxOwnKeys(value, options.budget, context)).then(keys =>
                allocateReflectionResult(keys.filter(key => typeof key === "string"), options.budget));
            return allocateReflectionResult(Object.getOwnPropertyNames(reflectionProperties(value)), options.budget);
          },
          name: "getOwnPropertyNames"
        }),
        getOwnPropertySymbols: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            if (typeof value === "object" && value !== null && guestProxyStates.has(value))
              return Promise.resolve(sandboxOwnKeys(value, options.budget, context)).then(keys =>
                allocateReflectionResult(keys.filter(key => typeof key === "symbol"), options.budget));
            return allocateReflectionResult(ownSandboxSymbolKeys(value), options.budget);
          },
          name: "getOwnPropertySymbols"
        }),
        defineProperty: createSandboxClosure({
          sandbox: true,
          call: async ([value, key, descriptor], context) => {
            objectProperties(value, true);
            const property = await toPropertyKey(key, options.budget, context);
            await defineDataProperty(
              value,
              property,
              await propertyDescriptor(descriptor, options.budget, context),
              options.budget,
              context
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
          call: ([value], context) => {
            if (typeof value === "object" && value !== null && guestProxyStates.has(value))
              return sandboxGetPrototypeOf(value, options.budget, context);
            if (isSandboxMap(value) || isSandboxSet(value))
              return getSandboxPrototype(value, options.budget) as SandboxValue;
            if (value !== null && value !== undefined && typeof value !== "object")
              value = createSandboxBox(value);
            objectProperties(value);
            return getSandboxPrototype(value as object, options.budget) as SandboxValue;
          },
          name: "getPrototypeOf"
        }),
        setPrototypeOf: createSandboxClosure({
          sandbox: true,
          call: ([value, prototype], context) => {
            if (value === null || value === undefined)
              throw new TypeError("Cannot set the prototype of null or undefined.");
            if (prototype !== null && typeof prototype !== "object")
              throw new TypeError("Prototype must be an object or null.");
            if (typeof value !== "object") return value;
            if (guestProxyStates.has(value)) {
              return Promise.resolve(sandboxSetPrototypeOf(value, prototype, options.budget, context)).then(success => {
                if (!success) throw new TypeError("Proxy refused setPrototypeOf.");
                return value;
              });
            }
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
        groupBy: createGroupBy(options.budget, "property"),
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
              const object = allocateProducedSandboxValue(
                Object.setPrototypeOf(
                  Reflect.apply(Object.fromEntries, Object, [
                    { [Symbol.iterator]: () => iterator }
                  ]),
                  null
                ),
                options.budget
              );
              const prototype = getSandboxPrototype(object as object, options.budget);
              if (prototype !== null) setSandboxPrototype(object as object, prototype, options.budget);
              return object;
            }
            return objectFromSandboxEntries(value, iterator, options.budget, context);
          },
          name: "fromEntries"
        }),
        preventExtensions: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            if (typeof value === "object" && value !== null && guestProxyStates.has(value)) {
              return Promise.resolve(sandboxPreventExtensions(value, options.budget, context)).then(success => {
                if (!success) throw new TypeError("Proxy refused preventExtensions.");
                return value;
              });
            }
            if (isGuestHostObject(value))
              throw new TypeError("Live host objects cannot be made non-extensible.");
            Object.preventExtensions(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value);
            return value;
          },
          name: "preventExtensions"
        }),
        isExtensible: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            typeof value === "object" && value !== null && guestProxyStates.has(value)
              ? sandboxIsExtensible(value, options.budget, context) :
            Object.isExtensible(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value),
          name: "isExtensible"
        }),
        seal: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            if (typeof value === "object" && value !== null && guestProxyStates.has(value))
              return setGuestProxyIntegrity(value, "sealed", options.budget, context);
            if (isGuestHostObject(value))
              throw new TypeError("Live host objects cannot be sealed.");
            Object.seal(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value);
            return value;
          },
          name: "seal"
        }),
        isSealed: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            typeof value === "object" && value !== null && guestProxyStates.has(value)
              ? testGuestProxyIntegrity(value, "sealed", options.budget, context) :
            Object.isSealed(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value),
          name: "isSealed"
        }),
        freeze: createSandboxClosure({
          sandbox: true,
          call: ([value], context) => {
            if (typeof value === "object" && value !== null && guestProxyStates.has(value))
              return setGuestProxyIntegrity(value, "frozen", options.budget, context);
            if (isGuestHostObject(value))
              throw new TypeError("Live host objects cannot be frozen.");
            if (typeof value === "object" && value !== null) {
            Object.freeze(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value);
            }

            return value;
          },
          name: "freeze"
        }),
        isFrozen: createSandboxClosure({
          sandbox: true,
          call: ([value], context) =>
            typeof value === "object" && value !== null && guestProxyStates.has(value)
              ? testGuestProxyIntegrity(value, "frozen", options.budget, context) :
            Object.isFrozen(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value),
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
    Array: createArrayGlobal(options.budget),
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
            call: (args, context) => stringFromCodes(args, String.fromCharCode, options.budget, context),
            name: "fromCharCode"
          }),
          fromCodePoint: createSandboxClosure({
            sandbox: true,
            call: (args, context) => stringFromCodes(args, String.fromCodePoint, options.budget, context),
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
          ...(options.numericParsers ?? createNumericParsers(options.budget)),
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

function createArrayGlobal(budget: Budget): SandboxClosure {
  const prototype: SandboxArray = [];
  const objectToString = Object.getOwnPropertyDescriptor(getSandboxPrototype(Object.create(null), budget)!, "toString")!.value as SandboxClosure;
  const constructor = createSandboxClosure({
    guest: true,
    sandbox: true,
    call: (args) => createArrayFromConstructorArgs(args, budget),
    construct: async (args, context) => {
      const target = context?.newTarget;
      const parent = target === undefined || target === constructor ? prototype
        : context?.getProperty === undefined ? await readPropertyDescriptor(
            getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context)
          : await context.getProperty(target, "prototype");
      const selected = typeof parent === "object" && parent !== null ? parent
        : getFunctionRealmPrototype(target, "Array", prototype);
      const value = createArrayFromConstructorArgs(args, budget);
      if (selected !== prototype) setSandboxPrototype(value, selected, budget);
      return value;
    },
    name: "Array",
    length: 1
  });
  const properties = materializeFunctionProperties(constructor);
  Object.defineProperty(properties, "prototype", { value: prototype, writable: false });
  Object.defineProperty(properties, Symbol.species, {
    get: accessorAdapter(createSandboxClosure({ guest: true, sandbox: true,
      name: "get [Symbol.species]", length: 0, call: (_args, context) => context?.thisValue
    }), "get"), configurable: true
  });
  Object.defineProperty(prototype, "constructor", { value: constructor, writable: true, configurable: true });
  const iteratorPrototype: SandboxObject = createIntrinsicObject();
  const iterablePrototype: SandboxObject = createIntrinsicObject();
  Object.defineProperty(iterablePrototype, Symbol.iterator, { value: createSandboxClosure({
    guest: true, sandbox: true, name: "[Symbol.iterator]", length: 0,
    call: (_args, context) => context?.thisValue
  }), writable: true, configurable: true });
  const iteratorTagGetter = createSandboxClosure({ guest: true, sandbox: true,
    name: "get [Symbol.toStringTag]", length: 0, call: () => "Iterator" });
  const iteratorTagSetter = createSandboxClosure({ guest: true, sandbox: true,
    name: "set [Symbol.toStringTag]", length: 1, call: ([value], context) => {
      const receiver = context?.thisValue;
      if (receiver === iterablePrototype || receiver === null || typeof receiver !== "object")
        throw new TypeError("Iterator tag setter requires a distinct object receiver.");
      defineOwnDataProperty(objectProperties(receiver, true), Symbol.toStringTag, value);
      createDataCheckpoint(budget, context)(receiver, 0, true);
      return undefined;
    }
  });
  Object.defineProperty(iterablePrototype, Symbol.toStringTag, {
    get: accessorAdapter(iteratorTagGetter, "get"), set: accessorAdapter(iteratorTagSetter, "set"), configurable: true
  });
  setSandboxPrototype(iterablePrototype, getSandboxPrototype(Object.create(null), budget));
  setSandboxPrototype(iteratorPrototype, iterablePrototype);
  Object.defineProperties(iteratorPrototype, {
    next: { value: createSandboxClosure({ guest: true, sandbox: true, name: "next", length: 0,
      call: (_args, context) => nextArrayIterator(context?.thisValue, budget, context)
    }), writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Array Iterator", configurable: true }
  });
  registerBuiltinIdentities(budget, { "%ArrayIteratorPrototype%": iteratorPrototype, "%IteratorPrototype%": iterablePrototype });
  registerIntrinsicFunction(budget, iterablePrototype[Symbol.iterator] as SandboxClosure);
  registerIntrinsicFunction(budget, iteratorTagGetter);
  registerIntrinsicFunction(budget, iteratorTagSetter);
  registerIntrinsicObject(budget, iterablePrototype);
  registerIntrinsicObject(budget, iteratorPrototype);
  for (const method of ["keys", "values", "entries"] as const) {
    const closure = createSandboxClosure({ guest: true, sandbox: true, name: method, length: 0,
      call: (_args, context) => {
        const receiver = context?.thisValue;
        if (receiver === null || receiver === undefined) throw new TypeError("Array iterator method requires a receiver.");
        const source = typeof receiver === "object" ? receiver : createSandboxBox(receiver);
        const iterator = restoreSandboxArrayIterator({ source, index: 0, method });
        setSandboxPrototype(iterator, iteratorPrototype, budget);
        return iterator;
      }
    });
    Object.defineProperty(prototype, method, { value: closure, writable: true, configurable: true });
    if (method === "values") Object.defineProperty(prototype, Symbol.iterator, { value: closure, writable: true, configurable: true });
  }
  for (const name of arrayMethodNames) {
    const method = createSandboxClosure({
      guest: true, sandbox: true, name,
      length: arrayMethodLengths[name],
      call: (args, context) => callArrayMethod(context?.thisValue, name, args, {
        budget, context,
        hasProperty: (value, key) => isGuestHostObject(value)
          ? hasOwnSandboxProperty(value, key, false) || getSandboxPropertyDescriptor(value, key, budget) !== undefined
          : sandboxHasProperty(value, key, budget, context),
        deleteProperty: (value, key) => sandboxDeleteProperty(value, String(key), budget, context),
        setProperty: (value, key, entry) => setSandboxProperty(value, key, entry, budget, true, context),
        callClosure: (closure, values, _stack, receiver) => invokeBuiltinClosure(closure, values, budget, context, receiver)
      }, context?.stack ?? [])
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
  }
  Object.defineProperty(prototype, "toString", {
    value: createSandboxClosure({ guest: true, sandbox: true, name: "toString", length: 0,
      call: async (_args, context) => {
        const receiver = context?.thisValue;
        if (receiver === null || receiver === undefined) throw new TypeError("Array toString requires a receiver.");
        const object = typeof receiver === "object" ? receiver : createSandboxBox(receiver);
        const method = context?.getProperty === undefined ? getSandboxDataProperty(object, "join", budget)
          : await context.getProperty(object, "join");
        return invokeBuiltinClosure(isSandboxClosure(method) ? method : objectToString, [], budget, context, object);
      }
    }), writable: true, configurable: true
  });
  const unscopables = createIntrinsicObject();
  for (const name of ["at", "copyWithin", "entries", "fill", "find", "findIndex",
    "findLast", "findLastIndex", "flat", "flatMap", "includes", "keys",
    "toReversed", "toSorted", "toSpliced", "values"]) unscopables[name] = true;
  setSandboxPrototype(unscopables, null);
  registerIntrinsicObject(budget, unscopables);
  Object.defineProperty(prototype, Symbol.unscopables, { value: unscopables, configurable: true });
  const statics = {
    isArray: createSandboxClosure({ sandbox: true, name: "isArray", call: ([value]) => sandboxIsArray(value, budget) }),
    from: createSandboxClosure({ sandbox: true, name: "from", call: (args, context) => arrayFromSandboxValues(args, budget, context) }),
    fromAsync: createSandboxClosure({ guest: true, sandbox: true, name: "fromAsync", length: 1,
      call: (args, context) => executeAsyncFunction(
        onSuspend => arrayFromSandboxValues(args, budget, context, onSuspend), budget, undefined, context)
    }),
    of: createSandboxClosure({ guest: true, sandbox: true, name: "of", length: 0,
      call: async (args, context) => {
        const target = context?.thisValue;
        let result: SandboxValue;
        const release = retainValues(budget, () => [...args, target, result]);
        try {
          result = isSandboxClosure(target) && target.construct !== undefined
            ? await invokeBuiltinClosure(target, [args.length], budget, context, undefined, true)
            : createArrayFromConstructorArgs([args.length], budget);
          const checkData = createDataCheckpoint(budget, context);
          checkData(result, 0, true);
          for (let index = 0; index < args.length; index += 1) {
            budget.visitNode();
            if (Array.isArray(result)) budget.allocateArrayLength(index + 1);
            defineOwnDataProperty(objectProperties(result, true), String(index), args[index]);
            checkData(result, 0, true);
          }
          await setSandboxProperty(result, "length", args.length, budget, true, context);
          checkData(result, 0, true);
          return allocateProducedSandboxValue(result, budget);
        } finally {
          release();
        }
      }
    })
  };
  for (const [name, value] of Object.entries(statics))
    Object.defineProperty(properties, name, { value, writable: true, configurable: true });
  installArrayPrototype(budget, prototype, constructor);
  return constructor;
}

async function objectFromSandboxEntries(
  items: SandboxValue,
  iterator: SandboxIterator,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  const object = Object.create(null) as SandboxObject;
  const prototype = getSandboxPrototype(object, budget);
  if (prototype !== null) setSandboxPrototype(object, prototype, budget);
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

  if (!isGuestHostObject(target)) objectProperties(target, true);

  if (context === undefined && ![target, ...sources].some(value =>
    typeof value === "object" && value !== null && guestProxyStates.has(value))) {
    for (const source of sources) {
      if (source === null || source === undefined) continue;
      const properties = isGuestHostObject(source) ? undefined : reflectionProperties(source);
      const keys = properties === undefined ? getOwnEnumerableKeys(source, true)
        : [...Object.getOwnPropertyNames(properties), ...ownSandboxSymbolKeys(source)];
      for (const key of keys) {
        if (!hasOwnSandboxProperty(source, key, true)) continue;
        const value = properties === undefined ? getSandboxDataProperty(source, key, budget)
          : Reflect.get(properties, key, source) as SandboxValue;
        setSandboxProperty(target, key, value, budget);
      }
    }
    return target;
  }
  return (async () => {
    let keys: PropertyKey[] = [];
    let value: SandboxValue;
    const release = retainValues(budget, () => [target, ...sources, keys, value]);
    try {
      for (const source of sources) {
        if (source === null || source === undefined) continue;
        const proxy = typeof source === "object" && guestProxyStates.has(source);
        const properties = isGuestHostObject(source) ? undefined : reflectionProperties(source);
        keys = proxy ? await sandboxOwnKeys(source, budget, context)
          : properties === undefined ? getOwnEnumerableKeys(source, true)
            : [...Object.getOwnPropertyNames(properties), ...ownSandboxSymbolKeys(source)];
        for (const key of keys) {
          budget.visitNode();
          const enumerable = proxy
            ? (await sandboxGetOwnPropertyDescriptor(source, key, budget, context))?.enumerable
            : hasOwnSandboxProperty(source, key, true);
          if (!enumerable) continue;
          value = await (context?.getProperty !== undefined
            ? context.getProperty(source, key)
            : isGuestHostObject(source) ? getSandboxDataProperty(source, key, budget)
              : readPropertyDescriptor(Object.getOwnPropertyDescriptor(properties!, key)!, source, context, true));
          await setSandboxProperty(target, key, value, budget, true, context);
        }
      }
      return target;
    } finally {
      release();
    }
  })();
}

export function reflectionProperties(value: SandboxValue): SandboxObject | SandboxArray {
  if (value !== null && value !== undefined && typeof value !== "object")
    value = createSandboxBox(value);
  return objectProperties(value);
}

export function objectProperties(value: SandboxValue, _mutable = false): SandboxObject | SandboxArray {
  if (isSandboxGenerator(value)) return getGeneratorProperties(value);
  if (isSandboxPromise(value)) return getPromiseProperties(value);
  if (isSandboxMap(value) || isSandboxSet(value)) return getCollectionProperties(value);
  if (isSandboxRegex(value)) return getRegexProperties(value);
  if (isSandboxDate(value)) {
    return value as unknown as SandboxObject;
  }
  if (isGuestHostObject(value))
    throw new TypeError("Live host object descriptors are not supported.");
  if (isSandboxClosure(value)) return materializeFunctionProperties(value);
  if (!isAssignableSandboxTarget(value))
    throw new TypeError("Expected a sandbox object or function.");
  return value;
}

export function exposePropertyDescriptor(descriptor: PropertyDescriptor, budget: Budget): SandboxObject {
  const result = (
    "value" in descriptor
      ? descriptor
      : {
          get: accessorClosure(descriptor.get, budget),
          set: accessorClosure(descriptor.set, budget),
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable
        }
  ) as SandboxObject;
  const prototype = getSandboxPrototype(result, budget);
  if (prototype !== null) setSandboxPrototype(result, prototype, budget);
  return result;
}

export async function propertyDescriptor(
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
      const present = sandboxHasProperty(input, field, budget, context);
      if (!(typeof present === "boolean" ? present : await present)) continue;
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
  const proxy = typeof descriptors === "object" && descriptors !== null && guestProxyStates.has(descriptors);
  let keys: PropertyKey[] = [];
  const release = retainValues(budget, () => [
    target,
    descriptors,
    properties,
    keys,
    ...properties.flatMap(([, descriptor]) => retainedAccessorClosures(descriptor))
  ]);
  try {
    keys = proxy ? await sandboxOwnKeys(descriptors, budget, context)
      : isGuestHostObject(descriptors) ? getOwnEnumerableKeys(descriptors, true)
        : [...Object.getOwnPropertyNames(reflectionProperties(descriptors)), ...ownSandboxSymbolKeys(descriptors)];
    for (const key of keys) {
      budget.visitNode();
      const enumerable = proxy
        ? (await sandboxGetOwnPropertyDescriptor(descriptors, key, budget, context))?.enumerable
        : hasOwnSandboxProperty(descriptors, key, true);
      if (!enumerable) continue;
      const descriptor = await (context?.getProperty !== undefined
        ? context.getProperty(descriptors, key)
        : getSandboxDataProperty(descriptors, key, budget));
      properties.push([key, await propertyDescriptor(descriptor, budget, context)]);
    }
    for (const [key, descriptor] of properties) await defineDataProperty(target, key, descriptor, budget, context);
  } finally {
    release();
  }
}

export function defineDataProperty(
  target: SandboxValue,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  budget: Budget,
  context?: SandboxCallContext,
  throwOnFailure = true
): undefined | boolean | Promise<undefined | boolean> {
  budget.visitNode();
  if (typeof target === "object" && target !== null && guestProxyStates.has(target)) {
    return defineGuestProxyProperty(target, key, descriptor, budget, context).then(success => {
      if (!success && throwOnFailure) throw new TypeError("Proxy refused defineProperty.");
      return throwOnFailure ? undefined : success;
    });
  }
  if (isNumericTypedArray(target) && typeof key !== "symbol" && isTypedArrayIndex(String(key)) && "value" in descriptor) {
    const { value, ...attributes } = descriptor;
    // Validates index and descriptor restrictions without writing an element.
    if (throwOnFailure) Object.defineProperty(target, key, attributes);
    else if (!Reflect.defineProperty(target, key, attributes)) return false;
    return (async () => {
      const release = retainValues(budget, () => [target, value]);
      try {
        const number = await typedArrayElement(value, typedArrayStorage(target).Native, budget, context);
        // Conversion may detach or shrink storage; TypedArraySetElement then
        // succeeds without writing, rather than revalidating the definition.
        Reflect.set(target, key, number);
        markDescriptorObject(target);
        return throwOnFailure ? undefined : true;
      } finally { release(); }
    })();
  }
  const properties = objectProperties(target, true);
  if (Array.isArray(properties)) {
    if (key === "length" && "value" in descriptor) {
      const applyLength = (first: number, second: number): undefined | boolean => {
        const length = first >>> 0;
        if (length !== second) throw new RangeError("Invalid array length.");
        budget.allocateArrayLength(length);
        const normalized = {...descriptor,value:length};
        if (throwOnFailure) Object.defineProperty(properties,key,normalized);
        else {
          const success = Reflect.defineProperty(properties,key,normalized);
          markDescriptorObject(properties);
          return success;
        }
        markDescriptorObject(properties);
        return undefined;
      };
      if (typeof descriptor.value === "number") return applyLength(descriptor.value,descriptor.value);
      return (async () => {
        const release = retainValues(budget, () => [target,descriptor.value]);
        try {
          // ArraySetLength intentionally converts object inputs twice.
          const first = await sandboxNumber(descriptor.value,budget,context);
          const second = await sandboxNumber(descriptor.value,budget,context);
          return applyLength(first,second);
        } finally { release(); }
      })();
    } else if (typeof key !== "symbol") {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key) {
        budget.allocateArrayLength(index + 1);
      }
    }
  }
  if (throwOnFailure) Object.defineProperty(properties, key, descriptor);
  else if (!Reflect.defineProperty(properties, key, descriptor)) return false;
  markDescriptorObject(properties);
  return throwOnFailure ? undefined : true;
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
  context?: SandboxCallContext,
  onSuspend?: () => void
): Promise<SandboxValue> {
  const asyncProtocol = onSuspend !== undefined;
  const awaitAsync = async <T>(pending: Promise<T>): Promise<T> => {
    onSuspend!();
    const leaveAwait = budget.enterAwait();
    try {
      return await suspendJob(pending);
    } finally {
      leaveAwait();
    }
  };
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
  // Observable iterator methods must be captured before construction but called
  // afterwards. Legacy low-level contexts can still use implicit built-in iteration.
  const observableMethod = !asyncProtocol && context?.getProperty !== undefined && !isGuestHostObject(items) &&
    getSandboxPropertyDescriptor(typeof items === "object" ? items : getBoxedPrototype(items, budget), Symbol.iterator, budget) !== undefined;
  const iteratorMethod = observableMethod ? await context!.getProperty!(items, Symbol.iterator) : undefined;
  if (iteratorMethod !== null && iteratorMethod !== undefined &&
      !isSandboxClosure(iteratorMethod) && typeof iteratorMethod !== "function")
    throw new TypeError("Iterator method must be callable.");
  let iterator = observableMethod ? undefined : context === undefined
    ? asyncProtocol ? getSandboxAsyncIterator(items, budget) : getSandboxIterator(items, budget)
    : await acquireSandboxIterator(items, budget, context, asyncProtocol);
  const iterable = observableMethod ? iteratorMethod !== null && iteratorMethod !== undefined : iterator !== undefined;
  const constructor = context?.thisValue;
  let result: SandboxValue;
  let currentValue: SandboxValue;
  let failure: unknown;
  const retained = {};
  budget.setRetainedValues(retained, () => [
    // Once acquired, a rooted protocol iterator owns the remaining input. Keep
    // the original only for array-like reads or implicit unrooted iterators.
    iterator?.retainedValue === undefined ? items : undefined,
    iteratorMethod,
    iterator?.retainedValue,
    mapFn,
    thisValue,
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
    if (!iterable) {
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
            iterable ? [] : [length],
            budget,
            context,
            undefined,
            true
          )
        : createArrayFromConstructorArgs([length], budget);
    checkData(result, 0, true);
    if (observableMethod && iterable)
      iterator = await getSandboxIteratorFromMethod(items, iteratorMethod, budget, context!);

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
        const pending = Promise.resolve(iterator.next());
        const next = await (asyncProtocol ? awaitAsync(pending) : pending);
        if (typeof next !== "object" || next === null)
          throw new TypeError("Iterator result must be an object.");
        if ((await readIteratorResult(iterator, next, "done")).value) break;
        currentValue = (await readIteratorResult(iterator, next, "value")).value;
      } else {
        currentValue = await read(index);
        if (asyncProtocol) currentValue = await awaitAsync(awaitSandboxValue(currentValue, undefined, budget, context));
      }
      try {
        if (Array.isArray(result)) budget.allocateArrayLength(index + 1);
        if (mapFn !== undefined) {
          currentValue = await invokeBuiltinClosure(
            mapFn,
            [currentValue, index],
            budget,
            context,
            thisValue
          );
          if (asyncProtocol) currentValue = await awaitAsync(awaitSandboxValue(currentValue, undefined, budget, context));
        }
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
    await setSandboxProperty(result, "length", index, budget, true, context);
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
  let value: SandboxArray;
  if (args.length !== 1 || typeof args[0] !== "number") {
    value = allocateProducedSandboxValue([...args], budget) as SandboxArray;
  } else {
    const lengthOrValue = args[0];
    if (!Number.isInteger(lengthOrValue) || lengthOrValue < 0 || lengthOrValue > 0xffffffff) {
      throw new RangeError("Invalid array length.");
    }
    budget.allocateArrayLength(lengthOrValue);
    const release = budget.provisionDataUsage(lengthOrValue + 1);
    try {
      value = new Array(lengthOrValue) as SandboxArray;
    } finally {
      release();
    }
  }
  const prototype = getSandboxPrototype(value, budget);
  if (prototype !== null) setSandboxPrototype(value, prototype, budget);
  return value;
}

async function getOwnEnumerableProperties(
  value: SandboxValue,
  kind: "key" | "value" | "key+value",
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxArray> {
  const entries: SandboxArray = [];
  const proxy = typeof value === "object" && value !== null && guestProxyStates.has(value);
  let keys: Array<string | symbol> = [];
  const release = retainValues(budget, () => [value, entries, keys]);
  try {
    keys = proxy
      ? await sandboxOwnKeys(value, budget, context)
      : isGuestHostObject(value)
        ? getOwnEnumerableKeys(value)
        : Object.getOwnPropertyNames(reflectionProperties(value));
    for (const key of keys) {
      budget.visitNode();
      if (typeof key !== "string") continue;
      const enumerable = proxy
        ? (await sandboxGetOwnPropertyDescriptor(value, key, budget, context))?.enumerable
        : hasOwnSandboxProperty(value, key, true);
      if (!enumerable) continue;
      if (kind === "key") entries.push(key);
      else {
        const entry = await (context?.getProperty !== undefined
          ? context.getProperty(value, key)
          : getSandboxDataProperty(value, key, budget));
        entries.push(kind === "value" ? entry : [key, entry]);
      }
    }
    return entries;
  } finally {
    release();
  }
}

export function allocateReflectionResult(value: SandboxArray, budget: Budget, entries = false): SandboxValue {
  const prototype = getSandboxPrototype(value, budget);
  if (prototype !== null) {
    setSandboxPrototype(value, prototype, budget);
    if (entries) {
      for (const pair of value) {
        if (Array.isArray(pair)) setSandboxPrototype(pair, prototype, budget);
      }
    }
  }
  return allocateProducedSandboxValue(value, budget);
}

function stringFromCodes(
  args: readonly SandboxValue[],
  convert: (value: number) => string,
  budget: Budget,
  context?: SandboxCallContext
): string | Promise<string> {
  let result = "";
  let index = 0;
  const release = retainValues(budget, () => [...args, result]);
  try {
    const output = advance();
    if (typeof output !== "string") return output.finally(release);
    release();
    return output;
  } catch (error) {
    release();
    throw error;
  }

  function advance(): string | Promise<string> {
    while (index < args.length) {
      budget.visitNode();
      const number = sandboxNumber(args[index++], budget, context);
      if (number instanceof Promise) return number.then(value => {
        result = budget.allocateString(result + convert(value));
        return advance();
      });
      result = budget.allocateString(result + convert(number));
    }
    return result;
  }
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
