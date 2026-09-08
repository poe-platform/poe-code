import { assertSandboxDataDepth } from "../../graph-depth.js";
import { getGeneratorProperties } from "../generator-properties.js";
import { accessorAdapter, accessorClosure, readPropertyDescriptor } from "../accessors.js";
import { isSandboxArguments } from "../arguments.js";
import type { Budget } from "../budget.js";
import { isSandboxDate } from "../date.js";
import { boxedValue, createSandboxBox, isSandboxBox } from "../boxed.js";
import { isSandboxErrorConstructorInstance } from "../exceptions.js";
import { hasHostObjectMember, isGuestHostObject } from "../host-capabilities.js";
import { collectionIteratorState, isSandboxCollectionIterator } from "../collection-iterator.js";
import { isSandboxRegExpIterator } from "../regexp-iterator.js";
import {
  createIntrinsicObject,
  getSandboxPrototype,
  getSandboxPropertyDescriptor,
  hasExplicitSandboxPrototype,
  installObjectPrototype,
  markDescriptorObject,
  materializeFunctionProperties,
  setSandboxPrototype
} from "../object-model.js";
import { toPropertyKey } from "../property-key.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  getCollectionProperties,
  isSandboxPromise,
  getPromiseProperties,
  isSandboxRegex,
  getRegexProperties,
  isSandboxSet,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";
import { measureSandboxData } from "../values.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { retainValues } from "../resources.js";
import { defineDataProperty, objectProperties } from "./object-array.js";

export function createObjectGlobal(methods: SandboxObject, budget: Budget): SandboxClosure {
  const construct = ([value]: readonly SandboxValue[]): SandboxValue => {
    if (value === null || value === undefined) {
      budget.chargeDataUsage(1);
      return Object.create(null) as SandboxObject;
    }
    if (typeof value !== "object") {
      const box = createSandboxBox(value);
      budget.chargeDataUsage(measureSandboxData([box]));
      return box;
    }
    return value;
  };
  const constructor = createSandboxClosure({
    guest: true,
    sandbox: true,
    name: "Object",
    length: 1,
    call: construct,
    construct: (args, context) => {
      if (context?.newTarget === undefined || context.newTarget === constructor)
        return construct(args);
      const value = construct([]) as SandboxObject;
      const prototype = context.getProperty!(context.newTarget, "prototype");
      const finish = (prototype: SandboxValue) => {
        if (typeof prototype === "object" && prototype !== null)
          setSandboxPrototype(value, prototype, budget);
        return value;
      };
      return prototype instanceof Promise ? prototype.then(finish) : finish(prototype);
    }
  });
  const properties = materializeFunctionProperties(constructor);
  const prototype = createIntrinsicObject(properties.prototype as SandboxObject);
  properties.prototype = prototype;
  Object.defineProperty(properties, "prototype", { writable: false });
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(properties, name, { value: method, writable: true, configurable: true });
  }
  const prototypeMethods: SandboxObject = {
    toLocaleString: createSandboxClosure({
      guest: true, sandbox: true, name: "toLocaleString", length: 0,
      call: async (_args, context) => {
        const receiver = requireReceiver(context?.thisValue);
        const object = construct([receiver]);
        const descriptor = getSandboxPropertyDescriptor(object, "toString", budget);
        const method = context?.getProperty === undefined
          ? descriptor === undefined ? undefined : await readPropertyDescriptor(descriptor, receiver, context)
          : await context.getProperty(receiver, "toString");
        if (!isSandboxClosure(method)) throw new TypeError("toString must be callable.");
        return invokeBuiltinClosure(method, [], budget, context, receiver);
      }
    }),
    toString: createSandboxClosure({
      sandbox: true,
      name: "toString",
      length: 0,
      call: (_args, context) => {
        const receiver = context?.thisValue;
        if (receiver === undefined || receiver === null)
          return budget.allocateString(`[object ${typeTag(receiver)}]`);
        const object = construct([receiver]);
        const descriptor = isGuestHostObject(object) ? undefined : getSandboxPropertyDescriptor(object, Symbol.toStringTag, budget);
        const fallback = typeTag(object, descriptor !== undefined || hasExplicitSandboxPrototype(object as object));
        const finish = (tag: SandboxValue) => budget.allocateString(`[object ${typeof tag === "string" ? tag : fallback}]`);
        if (descriptor === undefined) return finish(undefined);
        const tag = readPropertyDescriptor(descriptor, object, context, true);
        return tag instanceof Promise ? tag.then(finish) : finish(tag);
      }
    }),
    valueOf: createSandboxClosure({
      sandbox: true,
      name: "valueOf",
      length: 0,
      call: (_args, context) => {
        const value = requireReceiver(context?.thisValue);
        return construct([value]);
      }
    }),
    hasOwnProperty: createSandboxClosure({
      sandbox: true,
      name: "hasOwnProperty",
      length: 1,
      call: async ([key], context) => {
        const property = await toPropertyKey(key, budget, context);
        return hasOwnSandboxProperty(context?.thisValue, property, false);
      }
    }),
    propertyIsEnumerable: createSandboxClosure({
      sandbox: true,
      name: "propertyIsEnumerable",
      length: 1,
      call: async ([key], context) => {
        const property = await toPropertyKey(key, budget, context);
        return hasOwnSandboxProperty(context?.thisValue, property, true);
      }
    }),
    isPrototypeOf: createSandboxClosure({
      sandbox: true,
      name: "isPrototypeOf",
      length: 1,
      call: ([value], context) => {
        if (typeof value !== "object" || value === null) return false;
        const receiver = requireReceiver(context?.thisValue);
        let depth = 0;
        for (
          let current = getSandboxPrototype(value, budget);
          current !== null;
          current = getSandboxPrototype(current, budget)
        ) {
          budget.visitNode();
          assertSandboxDataDepth(depth++);
          if (current === receiver) return true;
        }
        return false;
      }
    })
  };
  for (const [name, kind, define] of [
    ["__defineGetter__", "get", true],
    ["__defineSetter__", "set", true],
    ["__lookupGetter__", "get", false],
    ["__lookupSetter__", "set", false]
  ] as const) {
    prototypeMethods[name] = createSandboxClosure({
      guest: true, sandbox: true, name, length: define ? 2 : 1,
      call: async ([key, accessor], context) => {
        const target = construct([requireReceiver(context?.thisValue)]);
        const release = retainValues(budget, () => [target, key, accessor]);
        try {
          if (define && !isSandboxClosure(accessor)) throw new TypeError("Accessor must be callable.");
          const property = await toPropertyKey(key, budget, context);
          if (define) {
            await defineDataProperty(target, property, {
              [kind]: accessorAdapter(accessor as SandboxClosure, kind),
              enumerable: true,
              configurable: true
            }, budget, context);
            return undefined;
          }
          let current = target as SandboxObject;
          let depth = 0;
          while (current !== null) {
            budget.visitNode();
            assertSandboxDataDepth(depth++);
            const descriptor = Object.getOwnPropertyDescriptor(objectProperties(current), property);
            if (descriptor !== undefined) return accessorClosure(descriptor[kind]);
            current = getSandboxPrototype(current, budget) as SandboxObject;
          }
          return undefined;
        } finally { release(); }
      }
    });
  }
  for (const [name, method] of Object.entries(prototypeMethods)) {
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
  }
  Object.defineProperty(prototype, "__proto__", {
    configurable: true,
    get: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "get __proto__", length: 0,
      call: (_args, context) => {
        const target = construct([requireReceiver(context?.thisValue)]);
        objectProperties(target);
        return getSandboxPrototype(target as object, budget) as SandboxValue;
      }
    }), "get"),
    set: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "set __proto__", length: 1,
      call: ([parent], context) => {
        const target = requireReceiver(context?.thisValue);
        if (parent !== null && typeof parent !== "object") return undefined;
        if (typeof target !== "object") return undefined;
        objectProperties(target, true);
        if (parent !== null) objectProperties(parent);
        setSandboxPrototype(target, parent, budget);
        return undefined;
      }
    }), "set")
  });
  markDescriptorObject(prototype);
  installObjectPrototype(budget, prototype, constructor);
  return constructor;
}

function requireReceiver(value: SandboxValue): Exclude<SandboxValue, null | undefined> {
  if (value === null || value === undefined)
    throw new TypeError("Object method requires a non-null receiver.");
  return value;
}

export function hasOwnSandboxProperty(
  value: SandboxValue,
  key: PropertyKey,
  enumerable: boolean
): boolean {
  requireReceiver(value);
  if (isGuestHostObject(value)) return typeof key === "symbol" ? false : hasHostObjectMember(value, String(key), enumerable);
  let properties: object;
  if (isSandboxClosure(value)) properties = materializeFunctionProperties(value);
  else if (isSandboxMap(value) || isSandboxSet(value)) properties = getCollectionProperties(value);
  else if (isSandboxPromise(value)) properties = getPromiseProperties(value);
  else if (isSandboxGenerator(value)) properties = getGeneratorProperties(value);
  else if (isSandboxRegex(value)) properties = getRegexProperties(value);
  else properties = Object(value) as object;
  const descriptor = Object.getOwnPropertyDescriptor(properties, key);
  return descriptor !== undefined && (!enumerable || descriptor.enumerable === true);
}

function typeTag(value: SandboxValue, builtinOnly = false): string {
  if (isSandboxBox(value)) value = boxedValue(value);
  if (value === undefined) return "Undefined";
  if (value === null) return "Null";
  if (typeof value === "string") return "String";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  if (isSandboxArguments(value)) return "Arguments";
  if (isSandboxClosure(value)) {
    if (builtinOnly) return "Function";
    while (value.boundTarget !== undefined) value = value.boundTarget;
    return value.generator ? "GeneratorFunction" : value.async ? "AsyncFunction" : "Function";
  }
  if (Array.isArray(value)) return "Array";
  if (isSandboxDate(value)) return "Date";
  if (isSandboxErrorConstructorInstance(value, "Error")) return "Error";
  if (isSandboxRegex(value)) return "RegExp";
  if (builtinOnly) return "Object";
  if (isSandboxRegExpIterator(value)) return "RegExp String Iterator";
  if (isSandboxCollectionIterator(value)) return collectionIteratorState(value).collectionKind === "map" ? "Map Iterator" : "Set Iterator";
  if (isSandboxGenerator(value)) return "Generator";
  return "Object";
}
