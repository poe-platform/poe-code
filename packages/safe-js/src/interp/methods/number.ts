import { Budget } from "../budget.js";
import { createSandboxClosure, type SandboxValue } from "../values.js";

export type NumberMethodName = "toExponential" | "toFixed" | "toPrecision" | "toString";

const numberMethodNames = new Set<NumberMethodName>([
  "toExponential",
  "toFixed",
  "toPrecision",
  "toString"
]);

export function getNumberMember(
  property: string | number,
  budget: Budget
): SandboxValue | undefined {
  if (!isNumberMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    name: `Number#${property}`,
    call: (args, context) => callNumberMethod(context?.thisValue, property, args, budget)
  });
}

export function isNumberMethodName(property: string | number): property is NumberMethodName {
  return typeof property === "string" && numberMethodNames.has(property as NumberMethodName);
}

export function callNumberMethod(
  value: SandboxValue,
  methodName: NumberMethodName,
  args: readonly SandboxValue[],
  budget: Budget
): string {
  if (typeof value !== "number") {
    throw new TypeError(`Number#${methodName} requires a number receiver.`);
  }

  return budget.allocateString(callNativeNumberMethod(value, methodName, args));
}

function callNativeNumberMethod(
  value: number,
  methodName: NumberMethodName,
  args: readonly SandboxValue[]
): string {
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

function asValidatedRadix(value: SandboxValue | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const radix = toIntegerOrInfinity(value);
  if (radix < 2 || radix > 36) {
    throw new RangeError("Number#toString radix must be between 2 and 36.");
  }

  return radix;
}

function asValidatedFractionDigits(
  value: SandboxValue | undefined,
  methodName: "toExponential" | "toFixed"
): number {
  const digits = toIntegerOrInfinity(value);
  if (digits < 0 || digits > 100) {
    throw new RangeError(`Number#${methodName} digits must be between 0 and 100.`);
  }

  return digits;
}

function asValidatedPrecision(value: SandboxValue | undefined): number {
  const precision = toIntegerOrInfinity(value);
  if (precision < 1 || precision > 100) {
    throw new RangeError("Number#toPrecision precision must be between 1 and 100.");
  }

  return precision;
}

function toIntegerOrInfinity(value: SandboxValue): number {
  const number = Number(value);

  if (Number.isNaN(number) || Object.is(number, 0) || Object.is(number, -0)) {
    return 0;
  }

  if (!Number.isFinite(number)) {
    return number;
  }

  return Math.trunc(number);
}
