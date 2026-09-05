import { createSandboxClosure, isSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { getGuestFunctionProperty, getSandboxPrototype, hasExplicitSandboxPrototype, isGuestClosure, setSandboxPrototype } from "../object-model.js";
import { assertSandboxDataDepth } from "../../graph-depth.js";
import type { Budget } from "../budget.js";
import { functionString } from "../function-string.js";
import { runResources } from "../resources.js";

export type FunctionMethodOptions = {
  budget?: Budget;
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    stack: readonly string[],
    thisValue: SandboxValue,
    construct?: boolean,
    newTarget?: SandboxClosure
  ) => Promise<SandboxValue> | SandboxValue;
};

type FunctionMethodName = "apply" | "bind" | "call" | "toString";

const functionMethodNames = new Set<FunctionMethodName>(["apply", "bind", "call", "toString"]);

export function getFunctionMember(
  target: SandboxClosure,
  property: string | number,
  options: FunctionMethodOptions
): SandboxValue | undefined {
  let current: object | null = target;
  let depth = 0;
  while (current !== null) {
    if (isGuestClosure(current)) {
      const value = getGuestFunctionProperty(current, String(property));
      if (value !== undefined || Object.hasOwn(current.properties ?? {}, String(property))) return value;
    } else if (isSandboxClosure(current)) {
      if (current.properties !== undefined && Object.hasOwn(current.properties, String(property)))
        return current.properties[String(property)];
      if (property === "length") return current.length;
    } else if (Object.hasOwn(current, String(property))) {
      return (current as Record<string, SandboxValue>)[String(property)];
    }
    if (isSandboxClosure(current) && !hasExplicitSandboxPrototype(current)) break;
    current = getSandboxPrototype(current, options.budget);
    if (current !== null) {
      options.budget?.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  if (current === null) return undefined;

  if (property === "toString" && runResources.getStore()?.functionSourceText === false) return undefined;

  if (!isFunctionMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    name: `Function#${property}`,
    ...(property === "toString" ? { length: 0 } : {}),
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
  if (methodName === "toString") {
    const text = functionString(target);
    return options.budget?.allocateString(text) ?? text;
  }
  const thisValue = args[0];

  if (methodName === "bind") {
    const boundArgs = args.slice(1);
    const bound = createSandboxClosure({
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
                true,
                context?.newTarget === bound ? target : context?.newTarget
              )
          })
    });
    if (hasExplicitSandboxPrototype(target))
      setSandboxPrototype(bound, getSandboxPrototype(target, options.budget), options.budget);
    return bound;
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
