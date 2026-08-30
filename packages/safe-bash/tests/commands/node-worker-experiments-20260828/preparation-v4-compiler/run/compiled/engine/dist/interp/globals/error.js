import { createSubsetErrorValue, isSandboxErrorConstructorInstance as isNamedSandboxErrorConstructorInstance } from "../exceptions.js";
import { createSandboxClosure, isSandboxClosure } from "../values.js";
const errorConstructorNames = new WeakMap();
const errorNames = [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "AggregateError"
];
export function createErrorGlobals(options) {
    return Object.fromEntries(errorNames.map((name) => [name, createErrorConstructor(name, options.budget)]));
}
export function isSandboxErrorConstructorInstance(value, constructor) {
    if (!isSandboxClosure(constructor)) {
        throw new TypeError("Right-hand side of 'instanceof' is not a function.");
    }
    const name = errorConstructorNames.get(constructor);
    if (name === undefined) {
        return false;
    }
    return isNamedSandboxErrorConstructorInstance(value, name);
}
export function isSandboxErrorConstructor(value) {
    return isSandboxClosure(value) && errorConstructorNames.has(value);
}
function createErrorConstructor(name, budget) {
    const call = (args, context) => createSubsetError(name, args, context?.stack ?? [], budget);
    const closure = createSandboxClosure({
        call,
        construct: call,
        name
    });
    errorConstructorNames.set(closure, name);
    return closure;
}
function createSubsetError(name, args, stackFrames, budget) {
    const message = name === "AggregateError" ? args[1] : args[0];
    const options = name === "AggregateError" ? args[2] : args[1];
    const error = createSubsetErrorValue(name, message, stackFrames, budget);
    if (name === "AggregateError") {
        const errors = Array.isArray(args[0]) ? [...args[0]] : [];
        budget.allocateArrayLength(errors.length);
        error.errors = errors;
    }
    if (isObjectLike(options) && Object.prototype.hasOwnProperty.call(options, "cause")) {
        error.cause = options.cause;
    }
    return error;
}
function isObjectLike(value) {
    return typeof value === "object" && value !== null;
}
