import { sandboxErrorTypes } from "../error/shape.js";
import type { Budget } from "./budget.js";
import { float32Storage, isFloat32Array } from "./float32.js";
import {
  isSandboxClosure,
  isSandboxPromise,
  type SandboxCallContext,
  type SandboxValue
} from "./values.js";

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
  return stringifyObject(value, budget, context, joining);
}

async function stringifyObject(
  value: SandboxValue & object,
  budget: Budget,
  context: SandboxCallContext | undefined,
  joining: Set<object>
): Promise<string> {
  const leaveCall = budget.enterCall();
  try {
    budget.visitNode();
    for (const name of ["toString", "valueOf"]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      let result: SandboxValue;
      if (descriptor === undefined) {
        if (name === "valueOf") continue;
        result = await defaultToString(value, budget, context, joining);
      } else {
        const hook = ownDataValue(value, name);
        if (!isSandboxClosure(hook)) continue;
        if (context?.invokeClosure === undefined) {
          throw new TypeError("String hooks require a sandbox call context.");
        }
        result = await context.invokeClosure(hook, [], value);
      }
      if (result === null || typeof result !== "object") {
        return sandboxString(result, budget, context, joining);
      }
    }
    throw new TypeError("Cannot convert object to primitive value");
  } finally {
    leaveCall();
  }
}

async function defaultToString(
  value: SandboxValue & object,
  budget: Budget,
  context: SandboxCallContext | undefined,
  joining: Set<object>
): Promise<SandboxValue> {
  if (Array.isArray(value) || isFloat32Array(value)) {
    if (Object.hasOwn(value, "join")) {
      const join = ownDataValue(value, "join");
      if (!isSandboxClosure(join))
        return isFloat32Array(value) ? "[object Float32Array]" : "[object Array]";
      if (context?.invokeClosure === undefined) {
        throw new TypeError("String hooks require a sandbox call context.");
      }
      return context.invokeClosure(join, [], value);
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
