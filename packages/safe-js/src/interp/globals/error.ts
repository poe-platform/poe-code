import type { Budget } from "../budget.js";
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

const errorConstructorNames = new WeakMap<SandboxClosure, ErrorName>();

const errorNames = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "AggregateError"
] as const;

export type ErrorName = (typeof errorNames)[number];

export type ErrorGlobals = Record<ErrorName, ReturnType<typeof createSandboxClosure>>;

export function createErrorGlobals(options: { budget: Budget }): ErrorGlobals {
  return Object.fromEntries(
    errorNames.map((name) => [name, createErrorConstructor(name, options.budget)])
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

function createErrorConstructor(name: ErrorName, budget: Budget): SandboxClosure {
  const call = (args: readonly SandboxValue[], context?: Parameters<SandboxClosure["call"]>[1]) =>
    createSubsetError(name, args, context?.stack ?? [], budget);
  const closure = createSandboxClosure({ sandbox: true, call, construct: call, name });

  errorConstructorNames.set(closure, name);
  return closure;
}

function createSubsetError(
  name: ErrorName,
  args: readonly SandboxValue[],
  stackFrames: readonly string[],
  budget: Budget
): SandboxObject {
  const message = name === "AggregateError" ? args[1] : args[0];
  const options = name === "AggregateError" ? args[2] : args[1];
  const error = createSubsetErrorValue(name, message, stackFrames, budget);

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
