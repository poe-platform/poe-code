import { sandboxErrorTypes } from "../error/shape.js";
import { readPropertyDescriptor } from "./accessors.js";
import { dateString, dateTime, isSandboxDate } from "./date.js";
import { getDateMember } from "./globals/date.js";
import type { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { float32Storage, isFloat32Array } from "./float32.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import { isGuestHostObject } from "./host-capabilities.js";
import { collectionIteratorState, isSandboxCollectionIterator } from "./collection-iterator.js";
import {
  getGuestFunctionProperties,
  getSandboxPrototype,
  hasExplicitSandboxPrototype,
  isGuestClosure
} from "./object-model.js";
import { getRegexMember } from "./methods/regex.js";
import { retainValues } from "./resources.js";
import { functionString } from "./function-string.js";
import { boxedValue, isSandboxBox } from "./boxed.js";
import {
  isSandboxClosure,
  isSandboxPromise,
  isSandboxMap,
  isSandboxSet,
  isSandboxRegex,
  isSandboxGenerator,
  type SandboxCallContext,
  type SandboxPrimitive,
  type SandboxValue
} from "./values.js";

const defaultStringHook = Symbol("defaultStringHook");
const defaultValueHook = Symbol("defaultValueHook");
const joiningArrays = new WeakSet<object>();

export function sandboxNumber(value: SandboxValue, budget: Budget, context?: SandboxCallContext): number | Promise<number> {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") throw new TypeError("Expected a sandbox value.");
    return Number(value);
  }
  return objectToPrimitive(value, budget, context, new Set(), "number").then(Number);
}

export function sandboxString(
  value: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext,
  joining = new Set<object>()
): string | Promise<string> {
  if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") throw new TypeError("Expected a sandbox value.");
    return budget.allocateString(String(value));
  }
  return objectToPrimitive(value, budget, context, joining, "string")
    .then(primitive => {
      if (typeof primitive === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
      return budget.allocateString(String(primitive));
    });
}

export async function joinSandboxArray(
  value: SandboxValue & object,
  length: number,
  separator: string,
  budget: Budget,
  context?: SandboxCallContext,
  joining = new Set<object>()
): Promise<string> {
  if (joiningArrays.has(value)) return "";
  joiningArrays.add(value);
  let text = "";
  const release = retainValues(budget, () => [value, text, separator]);
  try {
    for (let index = 0; index < length; index++) {
      budget.visitNode();
      const element = await readCoercionProperty(value, String(index), context);
      const part =
        element === null || element === undefined
          ? ""
          : await sandboxString(element, budget, context, joining);
      text = budget.allocateString(text + (index === 0 ? "" : separator) + part);
    }
    return text;
  } finally {
    release();
    joiningArrays.delete(value);
  }
}

export async function objectToPrimitive(
  value: SandboxValue & object,
  budget: Budget,
  context: SandboxCallContext | undefined,
  joining: Set<object>,
  hint: "string" | "number" | "default",
  ordinary = false
): Promise<SandboxPrimitive> {
  const leaveCall = budget.enterCall();
  try {
    budget.visitNode();
    const exotic = ordinary ? undefined : await conversionHook(value, Symbol.toPrimitive, budget, context);
    if (exotic !== undefined && exotic !== null) {
      if (!isSandboxClosure(exotic)) throw new TypeError("Symbol.toPrimitive must be callable");
      const result = await invokeBuiltinClosure(exotic, [hint], budget, context, value);
      if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
      throw new TypeError("Cannot convert object to primitive value");
    }
    const preferString = hint === "string";
    for (const name of preferString ? ["toString", "valueOf"] : ["valueOf", "toString"]) {
      const hook = await conversionHook(value, name, budget, context);
      let result: SandboxValue;
      if (hook === defaultStringHook) {
        result = await defaultToString(value, budget, context, joining);
      } else if (hook === defaultValueHook) {
        result = isSandboxDate(value)
          ? dateTime(value)
          : isSandboxBox(value)
            ? boxedValue(value)
            : value;
      } else {
        if (!isSandboxClosure(hook)) continue;
        result = await invokeBuiltinClosure(hook, [], budget, context, value);
      }
      if (result === null || typeof result !== "object") {
        if (typeof result === "function") throw new TypeError("Expected a sandbox value.");
        return result;
      }
    }
    throw new TypeError("Cannot convert object to primitive value");
  } finally {
    leaveCall();
  }
}

function conversionHook(
  value: SandboxValue & object,
  name: PropertyKey,
  budget: Budget,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> | typeof defaultStringHook | typeof defaultValueHook {
  const implicitBuiltin =
    !hasExplicitSandboxPrototype(value) &&
    (Array.isArray(value) ||
      isSandboxDate(value) ||
      isFloat32Array(value) ||
      sandboxErrorTypes.has(value) ||
      isSandboxClosure(value) ||
      isSandboxMap(value) ||
      isSandboxSet(value) ||
      isSandboxCollectionIterator(value) ||
      isSandboxPromise(value) ||
      isSandboxRegex(value) ||
      isSandboxGenerator(value) ||
      isGuestHostObject(value));
  let current: object | null = value;
  let depth = 0;
  while (current !== null) {
    const properties = isGuestClosure(current) ? getGuestFunctionProperties(current) : current;
    const descriptor =
      properties === undefined ? undefined : Object.getOwnPropertyDescriptor(properties, name);
    if (descriptor !== undefined) {
      return readPropertyDescriptor(descriptor, value, context);
    }
    const parent = getSandboxPrototype(current, budget);
    if (
      current === value &&
      (implicitBuiltin || (parent === null && !hasExplicitSandboxPrototype(value)))
    ) {
      if (name === "toString") return defaultStringHook;
      if (name === "valueOf") return defaultValueHook;
      if (name === Symbol.toPrimitive && isSandboxDate(value))
        return getDateMember(name, budget, context?.compilation?.owner);
    }
    current = parent;
    if (current !== null) {
      budget.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  return undefined;
}

async function defaultToString(
  value: SandboxValue & object,
  budget: Budget,
  context: SandboxCallContext | undefined,
  joining: Set<object>
): Promise<SandboxValue> {
  if (isSandboxBox(value)) return budget.allocateString(String(boxedValue(value)));
  if (isSandboxClosure(value)) return budget.allocateString(functionString(value));
  if (isSandboxMap(value)) return "[object Map]";
  if (isSandboxSet(value)) return "[object Set]";
  if (isSandboxCollectionIterator(value))
    return collectionIteratorState(value).collectionKind === "map"
      ? "[object Map Iterator]"
      : "[object Set Iterator]";
  if (isSandboxGenerator(value)) return "[object Generator]";
  if (isSandboxRegex(value)) {
    return budget.allocateString(
      `/${String(getRegexMember(value, "source", budget))}/${String(getRegexMember(value, "flags", budget))}`
    );
  }
  if (isSandboxDate(value)) return budget.allocateString(dateString(value));
  if (Array.isArray(value) || isFloat32Array(value)) {
    if (Object.hasOwn(value, "join")) {
      const join = await readCoercionProperty(value, "join", context);
      if (!isSandboxClosure(join))
        return isFloat32Array(value) ? "[object Float32Array]" : "[object Array]";
      return invokeBuiltinClosure(join, [], budget, context, value);
    }
    const length = isFloat32Array(value) ? float32Storage(value).length : value.length;
    return joinSandboxArray(value, length, ",", budget, context, joining);
  }
  if (sandboxErrorTypes.has(value)) {
    const nameValue = await readCoercionProperty(value, "name", context);
    const name =
      nameValue === undefined ? "Error" : await sandboxString(nameValue, budget, context, joining);
    const release = retainValues(budget, () => [name]);
    try {
      const messageValue = await readCoercionProperty(value, "message", context);
      const message =
        messageValue === undefined
          ? ""
          : await sandboxString(messageValue, budget, context, joining);
      return name === "" ? message : message === "" ? name : `${name}: ${message}`;
    } finally {
      release();
    }
  }
  return isSandboxPromise(value) ? "[object Promise]" : "[object Object]";
}

function readCoercionProperty(
  value: SandboxValue & object,
  name: string,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  if (context?.getProperty !== undefined) return context.getProperty(value, name);
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
}
