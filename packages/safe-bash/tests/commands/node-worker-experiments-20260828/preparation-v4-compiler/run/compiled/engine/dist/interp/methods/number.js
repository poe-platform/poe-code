import { createSandboxClosure } from "../values.js";
const numberMethodNames = new Set([
    "toExponential",
    "toFixed",
    "toPrecision",
    "toString"
]);
export function getNumberMember(value, property, budget) {
    if (!isNumberMethodName(property)) {
        return undefined;
    }
    return createSandboxClosure({
        name: `Number#${property}`,
        call: (args) => callNumberMethod(value, property, args, budget)
    });
}
export function isNumberMethodName(property) {
    return typeof property === "string" && numberMethodNames.has(property);
}
export function callNumberMethod(value, methodName, args, budget) {
    return budget.allocateString(callNativeNumberMethod(value, methodName, args));
}
function callNativeNumberMethod(value, methodName, args) {
    switch (methodName) {
        case "toString":
            return value.toString(asValidatedRadix(args[0]));
        case "toExponential":
            return args[0] === undefined
                ? value.toExponential()
                : value.toExponential(asValidatedFractionDigits(args[0], methodName));
        case "toFixed":
            return value.toFixed(asValidatedFractionDigits(args[0], methodName));
        case "toPrecision":
            return args[0] === undefined
                ? value.toPrecision()
                : value.toPrecision(asValidatedPrecision(args[0]));
    }
}
function asValidatedRadix(value) {
    if (value === undefined) {
        return undefined;
    }
    const radix = toIntegerOrInfinity(value);
    if (radix < 2 || radix > 36) {
        throw new RangeError("Number#toString radix must be between 2 and 36.");
    }
    return radix;
}
function asValidatedFractionDigits(value, methodName) {
    const digits = toIntegerOrInfinity(value);
    if (digits < 0 || digits > 100) {
        throw new RangeError(`Number#${methodName} digits must be between 0 and 100.`);
    }
    return digits;
}
function asValidatedPrecision(value) {
    const precision = toIntegerOrInfinity(value);
    if (precision < 1 || precision > 100) {
        throw new RangeError("Number#toPrecision precision must be between 1 and 100.");
    }
    return precision;
}
function toIntegerOrInfinity(value) {
    const number = Number(value);
    if (Number.isNaN(number) || Object.is(number, 0) || Object.is(number, -0)) {
        return 0;
    }
    if (!Number.isFinite(number)) {
        return number;
    }
    return Math.trunc(number);
}
