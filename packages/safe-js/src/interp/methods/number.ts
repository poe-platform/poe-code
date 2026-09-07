import { Budget } from "../budget.js";
import { sandboxNumber } from "../string-coercion.js";
import { isSandboxBox, boxedValue } from "../boxed.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxValue } from "../values.js";
import { formatNumberLocale } from "../number-locale.js";

export type NumberMethodName = "toExponential" | "toFixed" | "toPrecision" | "toString" | "toLocaleString";

export const numberMethodNames = new Set<NumberMethodName>([
  "toExponential",
  "toFixed",
  "toPrecision",
  "toString",
  "toLocaleString"
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
    ...(property === "toLocaleString" ? { guest: true, name: property, length: 0 } : {}),
    call: (args, context) => callNumberMethod(context?.thisValue, property, args, budget, context)
  });
}

export function isNumberMethodName(property: string | number): property is NumberMethodName {
  return typeof property === "string" && numberMethodNames.has(property as NumberMethodName);
}

export function callNumberMethod(
  value: SandboxValue,
  methodName: NumberMethodName,
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): string | Promise<string> {
  if (isSandboxBox(value)) value = boxedValue(value);
  if (typeof value !== "number") {
    throw new TypeError(`Number#${methodName} requires a number receiver.`);
  }

  if (methodName === "toLocaleString") return formatNumberLocale(value, args, budget, context);

  const argument = args[0];
  if (argument !== null && typeof argument === "object") {
    return formatObjectArgument(value, methodName, argument, budget, context);
  }
  return formatNumber(value, methodName, argument === undefined ? undefined : +(argument as number), budget);
}

async function formatObjectArgument(
  value: number,
  methodName: Exclude<NumberMethodName, "toLocaleString">,
  argument: SandboxValue & object,
  budget: Budget,
  context: SandboxCallContext | undefined
): Promise<string> {
  const retainedArgument = {};
  budget.setRetainedValues(retainedArgument, () => [argument]);
  try {
    const number = await sandboxNumber(argument, budget, context);
    return formatNumber(value, methodName, number, budget);
  } finally {
    budget.setRetainedValues(retainedArgument, undefined);
  }
}

function formatNumber(value: number, methodName: Exclude<NumberMethodName, "toLocaleString">, argument: number | undefined, budget: Budget): string {
  let result: string;
  try {
    result = value[methodName](argument);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const detail = methodName === "toString" ? "radix must be between 2 and 36."
      : methodName === "toPrecision" ? "precision must be between 1 and 100."
      : "digits must be between 0 and 100.";
    throw new RangeError(`Number#${methodName} ${detail}`);
  }
  return budget.allocateString(result);
}
