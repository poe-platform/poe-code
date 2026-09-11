import type { Budget } from "./budget.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import { readPropertyDescriptor } from "./accessors.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { isNumericTypedArray, typedArrayStorage } from "./typed-array.js";
import { numericTypedArrayConstructor } from "./globals/numeric-typed-array.js";
import { isSandboxErrorConstructorInstance } from "./globals/error.js";
import { getSandboxPropertyDescriptor, hasExplicitSandboxPrototype, isGuestClosure } from "./object-model.js";
import { sandboxGetPrototypeOf } from "./guest-proxy-prototype.js";
import { retainValues } from "./resources.js";
import { isSandboxClosure, type SandboxCallContext, type SandboxValue } from "./values.js";

export async function evaluateInstanceof(
  value: SandboxValue,
  constructor: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<boolean> {
  if (constructor === null || typeof constructor !== "object")
    throw new TypeError("Right-hand side of 'instanceof' must be an object.");
  const method = await readInstanceProperty(constructor, Symbol.hasInstance, budget, context);
  if (method !== undefined && method !== null) {
    if (!isSandboxClosure(method)) throw new TypeError("Symbol.hasInstance must be callable.");
    return Boolean(await invokeBuiltinClosure(method, [value], budget, context, constructor));
  }
  if (!isSandboxClosure(constructor))
    throw new TypeError("Right-hand side of 'instanceof' is not a function.");
  return ordinaryHasInstance(value, constructor, budget, context);
}

export async function ordinaryHasInstance(
  value: SandboxValue,
  constructor: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<boolean> {
  if (!isSandboxClosure(constructor)) return false;
  if (constructor.boundTarget !== undefined) {
    budget.visitNode();
    return evaluateInstanceof(value, constructor.boundTarget, budget, context);
  }
  // These existing built-ins do not yet have ordinary prototype graphs.
  if (numericTypedArrayConstructor(constructor) !== undefined && !isGuestClosure(constructor))
    return isNumericTypedArray(value) && typedArrayStorage(value).Native === numericTypedArrayConstructor(constructor);
  if ((!isGuestClosure(constructor) || (value !== null && typeof value === "object" && !hasExplicitSandboxPrototype(value))) &&
      isSandboxErrorConstructorInstance(value, constructor)) return true;
  if (!isGuestClosure(constructor) || typeof value !== "object" || value === null) return false;
  const prototype = await readInstanceProperty(constructor, "prototype", budget, context);
  if (typeof prototype !== "object" || prototype === null)
    throw new TypeError("Function has a non-object prototype in instanceof check.");
  let depth = 0;
  let current: SandboxValue = value;
  const release = retainValues(budget, () => [current, prototype]);
  try {
    while (current !== null) {
      budget.visitNode();
      assertSandboxDataDepth(depth++);
      const next = sandboxGetPrototypeOf(current, budget, context);
      current = next instanceof Promise ? await next : next;
      if (current === prototype) return true;
    }
    return false;
  } finally {
    release();
  }
}

async function readInstanceProperty(value: SandboxValue, key: PropertyKey, budget: Budget, context?: SandboxCallContext): Promise<SandboxValue> {
  if (context?.getProperty !== undefined) return context.getProperty(value, key);
  const descriptor = getSandboxPropertyDescriptor(value, key, budget);
  if (descriptor === undefined) return undefined;
  return readPropertyDescriptor(descriptor, value, {
    ...context, stack: context?.stack ?? [], thisValue: value,
    invokeClosure: context?.invokeClosure ?? ((closure, args, receiver) => invokeBuiltinClosure(closure, args, budget, context, receiver))
  });
}
