import { assertSandboxDataDepth } from "../../graph-depth.js";
import { readPropertyDescriptor } from "../accessors.js";
import { isSandboxArguments } from "../arguments.js";
import type { Budget } from "../budget.js";
import { isSandboxDate } from "../date.js";
import { boxedValue, createSandboxBox, isSandboxBox } from "../boxed.js";
import { isSandboxErrorConstructorInstance } from "../exceptions.js";
import { isFloat32Array } from "../float32.js";
import { hasHostObjectMember, isGuestHostObject } from "../host-capabilities.js";
import { collectionIteratorState, isSandboxCollectionIterator } from "../collection-iterator.js";
import {
  getSandboxPrototype,
  getSandboxPropertyDescriptor,
  hasExplicitSandboxPrototype,
  installObjectPrototype,
  isGuestClosure,
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
  isSandboxPromise,
  isSandboxRegex,
  getRegexProperties,
  isSandboxSet,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";
import { measureSandboxData } from "../values.js";

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
  const prototype = properties.prototype as SandboxObject;
  Object.defineProperty(properties, "prototype", { writable: false });
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(properties, name, { value: method, writable: true, configurable: true });
  }
  const prototypeMethods: SandboxObject = {
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
      call: async ([key], context) =>
        hasOwnSandboxProperty(
          requireReceiver(context?.thisValue),
          await toPropertyKey(key, budget, context),
          false
        )
    }),
    propertyIsEnumerable: createSandboxClosure({
      sandbox: true,
      name: "propertyIsEnumerable",
      length: 1,
      call: async ([key], context) =>
        hasOwnSandboxProperty(
          requireReceiver(context?.thisValue),
          await toPropertyKey(key, budget, context),
          true
        )
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
  for (const [name, method] of Object.entries(prototypeMethods)) {
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
  }
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
  if (isGuestClosure(value)) properties = materializeFunctionProperties(value);
  else if (isSandboxClosure(value)) {
    if (key === "length" || key === "name") return !enumerable;
    properties = value.properties ?? (Object.create(null) as SandboxObject);
  } else if (
    isSandboxMap(value) ||
    isSandboxSet(value) ||
    isSandboxPromise(value) ||
    isSandboxGenerator(value)
  )
    return false;
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
  if (isSandboxMap(value)) return "Map";
  if (isSandboxSet(value)) return "Set";
  if (isSandboxCollectionIterator(value)) return collectionIteratorState(value).collectionKind === "map" ? "Map Iterator" : "Set Iterator";
  if (isSandboxPromise(value)) return "Promise";
  if (isSandboxGenerator(value)) return "Generator";
  if (isFloat32Array(value)) return "Float32Array";
  return "Object";
}
