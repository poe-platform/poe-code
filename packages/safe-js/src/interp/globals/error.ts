import type { Budget } from "../budget.js";
import { types } from "node:util";
import { sandboxErrorTypes } from "../../error/shape.js";
import { errorPrototypes } from "../error-prototypes.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { sandboxHasProperty } from "../guest-proxy-has.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { sandboxString } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import { readPropertyDescriptor } from "../accessors.js";
import { acquireSandboxIterator, getSandboxIterator, readIteratorResult, type SandboxIterator } from "../iteration.js";
import {
  createSubsetErrorValue,
  isSandboxErrorConstructorInstance as isNamedSandboxErrorConstructorInstance
} from "../exceptions.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  type SandboxArray,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";
import type { SandboxCallContext } from "../values.js";

const errorConstructorNames = new WeakMap<SandboxClosure, ErrorName>();

const errorNames = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "SuppressedError"
] as const;

export type ErrorName = (typeof errorNames)[number];

export type ErrorGlobals = Record<ErrorName, ReturnType<typeof createSandboxClosure>>;

export function createErrorGlobals(options: { budget: Budget; errorPrototypes?: boolean }): ErrorGlobals {
  return Object.fromEntries(
    errorNames.map((name) => [name, createErrorConstructor(name, options.budget, options.errorPrototypes === true)])
  ) as ErrorGlobals;
}

export function isSandboxErrorConstructorInstance(
  value: SandboxValue,
  constructor: SandboxValue
): boolean {
  if (!isSandboxClosure(constructor)) {
    throw new TypeError("Right-hand side of 'instanceof' is not a function.");
  }

  const name = errorConstructorNames.get(constructor);
  if (name === undefined) {
    return false;
  }

  return isNamedSandboxErrorConstructorInstance(value, name);
}

export function isSandboxErrorConstructor(value: SandboxValue): value is SandboxClosure {
  return isSandboxClosure(value) && errorConstructorNames.has(value);
}

function createErrorConstructor(name: ErrorName, budget: Budget, guest: boolean): SandboxClosure {
  const call = (args: readonly SandboxValue[], context?: Parameters<SandboxClosure["call"]>[1]) =>
    errorPrototypes.has(budget) ? createNativeError(name, args, budget, context, closure)
      : createSubsetError(name, args, context?.stack ?? [], budget);
  const closure = createSandboxClosure({ guest, sandbox: true, call, construct: call, name, length: name === "SuppressedError" ? 3 : name === "AggregateError" ? 2 : 1 });

  errorConstructorNames.set(closure, name);
  return closure;
}

export function createErrorPrototypes(budget: Budget, constructors: ErrorGlobals): void {
  const prototypes = new Map<ErrorName, SandboxObject>();
  for (const name of errorNames) prototypes.set(name, createIntrinsicObject());
  errorPrototypes.set(budget, prototypes);
  for (const name of errorNames) {
    const constructor = constructors[name];
    const prototype = prototypes.get(name)!;
    Object.defineProperties(prototype, {
      name: { value: name, writable: true, configurable: true },
      message: { value: "", writable: true, configurable: true },
      constructor: { value: constructor, writable: true, configurable: true }
    });
    Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
    setSandboxPrototype(prototype, name === "Error" ? getSandboxPrototype(Object.create(null), budget) : prototypes.get("Error")!);
    if (name !== "Error") setSandboxPrototype(constructor, constructors.Error);
  }
  Object.defineProperty(prototypes.get("Error")!, "toString", {
    writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "toString", length: 0,
      call: async (_args, context) => {
        const receiver = context?.thisValue;
        if (receiver === null || typeof receiver !== "object") throw new TypeError("Error.prototype.toString requires an object.");
        let name: string | undefined;
        const release = retainValues(budget, () => [receiver, name]);
        try {
          const rawName = await readErrorProperty(receiver, "name", budget, context);
          name = rawName === undefined ? "Error" : await sandboxString(rawName, budget, context);
          const rawMessage = await readErrorProperty(receiver, "message", budget, context);
          const message = rawMessage === undefined ? "" : await sandboxString(rawMessage, budget, context);
          return budget.allocateString(name === "" ? message : message === "" ? name : `${name}: ${message}`);
        } finally { release(); }
      }
    })
  });
  const isError = createSandboxClosure({
    guest: true, sandbox: true, name: "isError", length: 1,
    call: ([value]) => typeof value === "object" && value !== null &&
      (sandboxErrorTypes.has(value) || types.isNativeError(value))
  });
  Object.defineProperty(materializeFunctionProperties(constructors.Error), "isError", {
    value: isError, writable: true, configurable: true
  });
  registerBuiltinIdentities(budget, Object.fromEntries(errorNames.map(name => [name, constructors[name]])));
  registerIntrinsicFunction(budget, isError);
  for (const name of errorNames) {
    registerIntrinsicFunction(budget, constructors[name]);
    registerIntrinsicObject(budget, prototypes.get(name)!);
  }
}

async function readErrorProperty(value: SandboxValue, key: PropertyKey, budget: Budget, context?: SandboxCallContext): Promise<SandboxValue> {
  if (context?.getProperty !== undefined) return context.getProperty(value, key);
  const descriptor = getSandboxPropertyDescriptor(value, key, budget);
  return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
}

async function createNativeError(name: ErrorName, args: readonly SandboxValue[], budget: Budget, context: SandboxCallContext | undefined, constructor: SandboxClosure): Promise<SandboxObject> {
  const newTarget = context?.newTarget ?? constructor;
  const candidate = await readErrorProperty(newTarget, "prototype", budget, context);
  const prototype = candidate !== null && typeof candidate === "object" ? candidate
    : getFunctionRealmPrototype(newTarget, name, errorPrototypes.get(budget)!.get(name)!);
  let error: SandboxObject | undefined;
  let iterator: SandboxIterator | undefined;
  const errors: SandboxValue[] = [];
  const release = retainValues(budget, () => [prototype, error, iterator?.retainedValue, ...errors, ...args]);
  try {
    const message = name === "SuppressedError" ? args[2] : name === "AggregateError" ? args[1] : args[0];
    const options = name === "SuppressedError" ? undefined : name === "AggregateError" ? args[2] : args[1];
    const text = message === undefined ? undefined : await sandboxString(message, budget, context);
    error = createSubsetErrorValue(name, text, context?.stack ?? [], budget);
    setSandboxPrototype(error, prototype, budget);
    if (options !== null && typeof options === "object" && await sandboxHasProperty(options, "cause", budget, context)) {
      const cause = await readErrorProperty(options, "cause", budget, context);
      Object.defineProperty(error, "cause", { value: cause, writable: true, configurable: true });
    }
    if (name === "SuppressedError") {
      Object.defineProperties(error, {
        error: { value: args[0], writable: true, configurable: true },
        suppressed: { value: args[1], writable: true, configurable: true }
      });
    }
    if (name === "AggregateError") {
      const errorsPrototype = getSandboxPrototype(errors, budget);
      if (errorsPrototype !== null) setSandboxPrototype(errors, errorsPrototype, budget);
      iterator = context === undefined ? getSandboxIterator(args[0], budget) : await acquireSandboxIterator(args[0], budget, context);
      if (iterator === undefined) throw new TypeError("AggregateError errors must be iterable.");
      while (true) {
        budget.visitNode();
        const result = await iterator.next();
        if (result === null || typeof result !== "object") throw new TypeError("Iterator result must be an object.");
        if ((await readIteratorResult(iterator, result, "done")).value) break;
        budget.allocateArrayLength(errors.length + 1);
        errors.push((await readIteratorResult(iterator, result, "value")).value);
      }
      Object.defineProperty(error, "errors", { value: errors, writable: true, configurable: true });
    }
    return error;
  } finally { release(); }
}

function createSubsetError(
  name: ErrorName,
  args: readonly SandboxValue[],
  stackFrames: readonly string[],
  budget: Budget
): SandboxObject {
  const message = name === "SuppressedError" ? args[2] : name === "AggregateError" ? args[1] : args[0];
  const options = name === "SuppressedError" ? undefined : name === "AggregateError" ? args[2] : args[1];
  const error = createSubsetErrorValue(name, message, stackFrames, budget);

  if (name === "SuppressedError") {
    error.error = args[0];
    error.suppressed = args[1];
  }

  if (name === "AggregateError") {
    const errors = Array.isArray(args[0]) ? ([...args[0]] as SandboxArray) : [];
    budget.allocateArrayLength(errors.length);
    error.errors = errors;
  }

  if (isObjectLike(options) && Object.prototype.hasOwnProperty.call(options, "cause")) {
    error.cause = (options as SandboxObject).cause;
  }

  return error;
}

function isObjectLike(value: SandboxValue): value is SandboxArray | SandboxObject {
  return typeof value === "object" && value !== null;
}
