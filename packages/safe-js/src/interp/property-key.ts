import type { Budget } from "./budget.js";
import { isSandboxDate } from "./date.js";
import { isFloat32Array } from "./float32.js";
import { isGuestHostObject } from "./host-capabilities.js";
import { getSandboxDataProperty } from "./object-model.js";
import { sandboxString } from "./string-coercion.js";
import {
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  isSandboxSet,
  type SandboxCallContext,
  type SandboxValue
} from "./values.js";

export async function toPropertyKey(
  value: SandboxValue,
  budget: Budget,
  context: SandboxCallContext
): Promise<string> {
  if (typeof value === "string") return value;
  const invocation: SandboxCallContext =
    context.invokeClosure === undefined
      ? {
          ...context,
          invokeClosure: async (closure, args, thisValue) => {
            const leaveCall = budget.enterCall();
            try {
              const result = closure.call(args, { ...invocation, thisValue });
              if (isSandboxPromise(result)) {
                await result.synchronousPrefix;
                return result;
              }
              return await result;
            } finally {
              leaveCall();
            }
          }
        }
      : context;

  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isSandboxClosure(value) &&
    !isSandboxMap(value) &&
    !isSandboxSet(value) &&
    !isSandboxPromise(value) &&
    !isSandboxRegex(value) &&
    !isSandboxDate(value) &&
    !isFloat32Array(value) &&
    !isSandboxGenerator(value) &&
    !isGuestHostObject(value)
  ) {
    for (const name of ["toString", "valueOf"] as const) {
      const method = getSandboxDataProperty(value, name, budget);
      if (!isSandboxClosure(method)) continue;
      const primitive = await invocation.invokeClosure!(method, [], value);
      if (primitive === null || typeof primitive !== "object") {
        return budget.allocateString(String(primitive));
      }
    }
    throw new TypeError("Cannot convert object to primitive value.");
  }
  return sandboxString(value, budget, invocation);
}
