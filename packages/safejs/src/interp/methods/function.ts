import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";

export type FunctionMethodOptions = {
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    stack: readonly string[],
    thisValue: SandboxValue
  ) => Promise<SandboxValue> | SandboxValue;
};

type FunctionMethodName = "apply" | "call";

const functionMethodNames = new Set<FunctionMethodName>(["apply", "call"]);

export function getFunctionMember(
  target: SandboxClosure,
  property: string | number,
  options: FunctionMethodOptions
): SandboxValue | undefined {
  const propertyValue = target.properties?.[String(property)];
  if (propertyValue !== undefined || Object.hasOwn(target.properties ?? {}, String(property))) {
    return propertyValue;
  }

  if (!isFunctionMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    name: `Function#${property}`,
    call: (args, context) =>
      callFunctionMethod(target, property, args, options, context?.stack ?? [])
  });
}

function isFunctionMethodName(property: string | number): property is FunctionMethodName {
  return typeof property === "string" && functionMethodNames.has(property as FunctionMethodName);
}

function callFunctionMethod(
  target: SandboxClosure,
  methodName: FunctionMethodName,
  args: readonly SandboxValue[],
  options: FunctionMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> | SandboxValue {
  const thisValue = args[0];

  if (methodName === "call") {
    return options.callClosure(target, args.slice(1), stack, thisValue);
  }

  const applyArgs = args[1];
  if (applyArgs === null || applyArgs === undefined) {
    return options.callClosure(target, [], stack, thisValue);
  }
  if (!Array.isArray(applyArgs)) {
    throw new TypeError("Function#apply requires an array or nullish arguments value.");
  }

  return options.callClosure(target, applyArgs, stack, thisValue);
}
