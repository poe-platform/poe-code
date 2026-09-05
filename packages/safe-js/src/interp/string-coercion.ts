import { sandboxErrorTypes } from "../error/shape.js";
import { dateString, dateTime, isSandboxDate } from "./date.js";
import type { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { float32Storage, isFloat32Array } from "./float32.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import { isGuestHostObject } from "./host-capabilities.js";
import {
  getGuestFunctionProperties,
  getSandboxPrototype,
  hasExplicitSandboxPrototype,
  isGuestClosure
} from "./object-model.js";
import { getRegexMember } from "./methods/regex.js";
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
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") throw new TypeError("Expected a sandbox value.");
    return budget.allocateString(String(value));
  }
  return objectToPrimitive(value, budget, context, joining, "string")
    .then(primitive => budget.allocateString(String(primitive)));
}

async function objectToPrimitive(
  value: SandboxValue & object,
  budget: Budget,
  context: SandboxCallContext | undefined,
  joining: Set<object>,
  hint: "string" | "number"
): Promise<SandboxPrimitive> {
  const leaveCall = budget.enterCall();
  try {
    budget.visitNode();
    for (const name of hint === "string" ? ["toString", "valueOf"] : ["valueOf", "toString"]) {
      const hook = conversionHook(value, name, budget);
      let result: SandboxValue;
      if (hook === defaultStringHook) {
        result = await defaultToString(value, budget, context, joining);
      } else if (hook === defaultValueHook) {
        result = isSandboxDate(value) ? dateTime(value) : value;
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
  name: string,
  budget: Budget
): SandboxValue | typeof defaultStringHook | typeof defaultValueHook {
  const implicitBuiltin =
    !hasExplicitSandboxPrototype(value) &&
    (Array.isArray(value) ||
      isSandboxDate(value) ||
      isFloat32Array(value) ||
      sandboxErrorTypes.has(value) ||
      isSandboxClosure(value) ||
      isSandboxMap(value) ||
      isSandboxSet(value) ||
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
      if (!Object.hasOwn(descriptor, "value"))
        throw new TypeError("String conversion requires sandbox data properties.");
      return descriptor.value as SandboxValue;
    }
    const parent = getSandboxPrototype(current, budget);
    if (
      current === value &&
      (implicitBuiltin || (parent === null && !hasExplicitSandboxPrototype(value)))
    ) {
      return name === "toString" ? defaultStringHook : defaultValueHook;
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
  if (isSandboxMap(value)) return "[object Map]";
  if (isSandboxSet(value)) return "[object Set]";
  if (isSandboxGenerator(value)) return "[object Generator]";
  if (isSandboxRegex(value)) {
    return budget.allocateString(
      `/${getRegexMember(value, "source", budget)}/${getRegexMember(value, "flags", budget)}`
    );
  }
  if (isSandboxDate(value)) return budget.allocateString(dateString(value));
  if (Array.isArray(value) || isFloat32Array(value)) {
    if (Object.hasOwn(value, "join")) {
      const join = ownDataValue(value, "join");
      if (!isSandboxClosure(join))
        return isFloat32Array(value) ? "[object Float32Array]" : "[object Array]";
      return invokeBuiltinClosure(join, [], budget, context, value);
    }
    if (joining.has(value)) return "";
    joining.add(value);
    try {
      const length = isFloat32Array(value) ? float32Storage(value).length : value.length;
      let text = "";
      for (let index = 0; index < length; index++) {
        budget.visitNode();
        const element = ownDataValue(value, String(index));
        const part =
          element === null || element === undefined
            ? ""
            : await sandboxString(element, budget, context, joining);
        text = budget.allocateString(text + (index === 0 ? "" : ",") + part);
      }
      return text;
    } finally {
      joining.delete(value);
    }
  }
  if (sandboxErrorTypes.has(value)) {
    const nameValue = ownDataValue(value, "name");
    const name =
      nameValue === undefined ? "Error" : await sandboxString(nameValue, budget, context, joining);
    const messageValue = ownDataValue(value, "message");
    const message =
      messageValue === undefined ? "" : await sandboxString(messageValue, budget, context, joining);
    return name === "" ? message : message === "" ? name : `${name}: ${message}`;
  }
  return isSandboxPromise(value) ? "[object Promise]" : "[object Object]";
}

function ownDataValue(value: object, name: string): SandboxValue {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor !== undefined && !Object.hasOwn(descriptor, "value")) {
    throw new TypeError("String conversion requires sandbox data properties.");
  }
  return descriptor?.value as SandboxValue;
}
