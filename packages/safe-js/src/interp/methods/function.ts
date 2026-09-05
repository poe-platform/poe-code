import { createSandboxClosure, isSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { getGuestFunctionProperty, isGuestClosure } from "../object-model.js";

export type FunctionMethodOptions = {
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    stack: readonly string[],
    thisValue: SandboxValue,
    construct?: boolean
  ) => Promise<SandboxValue> | SandboxValue;
};

type FunctionMethodName = "apply" | "bind" | "call";

const functionMethodNames = new Set<FunctionMethodName>(["apply", "bind", "call"]);

export function getFunctionMember(
  target: SandboxClosure,
  property: string | number,
  options: FunctionMethodOptions
): SandboxValue | undefined {
  if (isGuestClosure(target)) {
    const value = getGuestFunctionProperty(target, String(property));
    if (value !== undefined || Object.hasOwn(target.properties ?? {}, String(property))) return value;
    if (!isFunctionMethodName(property)) return undefined;
  }
  const properties = target.properties;
  if (properties !== undefined && Object.hasOwn(properties, String(property))) {
    return properties[String(property)];
  }

  if (property === "length") {
    return target.length;
  }

  if (!isFunctionMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    name: `Function#${property}`,
    call: (args, context) =>
      callFunctionMethod(context?.thisValue, property, args, options, context?.stack ?? [])
  });
}

function isFunctionMethodName(property: string | number): property is FunctionMethodName {
  return typeof property === "string" && functionMethodNames.has(property as FunctionMethodName);
}

function callFunctionMethod(
  target: SandboxValue,
  methodName: FunctionMethodName,
  args: readonly SandboxValue[],
  options: FunctionMethodOptions,
  stack: readonly string[]
): Promise<SandboxValue> | SandboxValue {
  if (!isSandboxClosure(target)) {
    throw new TypeError(`Function#${methodName} requires a callable receiver.`);
  }
  const thisValue = args[0];

  if (methodName === "bind") {
    const boundArgs = args.slice(1);
    return createSandboxClosure({
      guest: true,
      sandbox: true,
      name: `bound ${target.name ?? ""}`,
      length:
        target.length === undefined ? undefined : Math.max(0, target.length - boundArgs.length),
      boundTarget: target,
      retainedValues: () => [target, thisValue, ...boundArgs],
      call: (callArgs, context) =>
        options.callClosure(target, [...boundArgs, ...callArgs], context?.stack ?? [], thisValue),
      ...(target.construct === undefined
        ? {}
        : {
            construct: (callArgs, context) =>
              options.callClosure(
                target,
                [...boundArgs, ...callArgs],
                context?.stack ?? [],
                undefined,
                true
              )
          })
    });
  }

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
