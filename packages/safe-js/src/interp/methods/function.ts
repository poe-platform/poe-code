import {
  createSandboxClosure,
  isSandboxClosure,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import {
  getGuestFunctionProperty,
  getSandboxPropertyDescriptor,
  getSandboxPrototype,
  hasExplicitSandboxPrototype,
  isGuestClosure,
  setSandboxPrototype
} from "../object-model.js";
import { assertSandboxDataDepth } from "../../graph-depth.js";
import { Budget } from "../budget.js";
import { functionString } from "../function-string.js";
import { retainValues, runResources } from "../resources.js";
import { createBoundFunction } from "../bound-function.js";
import { sandboxNumber } from "../string-coercion.js";
import { readPropertyDescriptor } from "../accessors.js";
import { guestProxyStates } from "../guest-proxy.js";
import { sandboxGetPrototypeOf } from "../guest-proxy-prototype.js";
import { sandboxGetOwnPropertyDescriptor } from "../guest-proxy-descriptor.js";

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
    if (isSandboxClosure(current)) {
      const value = getGuestFunctionProperty(current, String(property));
      if (value !== undefined || Object.hasOwn(current.properties ?? {}, String(property)))
        return value;
    } else if (Object.hasOwn(current, String(property))) {
      return (current as Record<string, SandboxValue>)[String(property)];
    }
    if (isSandboxClosure(current) && !hasExplicitSandboxPrototype(current) && getSandboxPrototype(current, options.budget) === null) break;
    current = getSandboxPrototype(current, options.budget);
    if (current !== null) {
      options.budget?.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  if (current === null) return undefined;

  if (property === "toString" && runResources.getStore()?.functionSourceText === false)
    return undefined;

  if (!isFunctionMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    name: `Function#${property}`,
    ...(property === "toString" ? { length: 0 } : {}),
    call: (args, context) =>
      callFunctionMethod(context?.thisValue, property, args, options, context?.stack ?? [], context)
  });
}

function isFunctionMethodName(property: string | number): property is FunctionMethodName {
  return typeof property === "string" && functionMethodNames.has(property as FunctionMethodName);
}

export function callFunctionMethod(
  target: SandboxValue,
  methodName: FunctionMethodName,
  args: readonly SandboxValue[],
  options: FunctionMethodOptions,
  stack: readonly string[],
  context?: SandboxCallContext
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
    const proxy = guestProxyStates.has(target);
    let prototype = proxy ? null : getSandboxPrototype(target, options.budget);
    const preservePrototype = proxy || prototype !== null || hasExplicitSandboxPrototype(target);
    const bind = (length: number | undefined, name: string) => {
      const bound = createBoundFunction({ target, thisValue, args: boundArgs }, `bound ${name}`, length, options.callClosure);
      if (preservePrototype) setSandboxPrototype(bound, prototype, options.budget);
      return bound;
    };
    if (context?.getProperty === undefined && !proxy)
      return bind(
        target.length === undefined ? undefined : Math.max(0, target.length - boundArgs.length),
        target.name ?? ""
      );
    return (async () => {
      const budget = options.budget ?? new Budget();
      const release = retainValues(budget, () => [target, prototype, ...boundArgs]);
      try {
        if (proxy) prototype = await sandboxGetPrototypeOf(target, budget, context) as object | null;
        const properties = target.properties;
        const defaultName = target.name;
        const hasLength = proxy
          ? await sandboxGetOwnPropertyDescriptor(target, "length", budget, context) !== undefined
          : !isGuestClosure(target) ||
          target.properties === undefined ||
          Object.hasOwn(target.properties, "length");
        const length = hasLength ? await context!.getProperty!(target, "length") : undefined;
        const name =
          !isGuestClosure(target) && !Object.hasOwn(properties ?? {}, "name")
            ? defaultName
            : await context!.getProperty!(target, "name");
        return bind(
          typeof length === "number" && !Number.isNaN(length)
            ? Math.max(0, Math.trunc(length) - boundArgs.length)
            : 0,
          typeof name === "string" ? name : ""
        );
      } finally { release?.(); }
    })();
  }

  if (methodName === "call") {
    return options.callClosure(target, args.slice(1), stack, thisValue);
  }

  const applyArgs = args[1];
  if (applyArgs === null || applyArgs === undefined) {
    return options.callClosure(target, [], stack, thisValue);
  }
  if (typeof applyArgs !== "object") {
    throw new TypeError("Function#apply requires an object or nullish arguments value.");
  }

  // Preserve immediate low-level calls for plain data arrays, but still copy
  // their argument list and check its allocation before invoking the target.
  if (context?.getProperty === undefined && Array.isArray(applyArgs)) {
    const budget = options.budget ?? new Budget();
    const length = applyArgs.length;
    budget.allocateArrayLength(length);
    const values: SandboxValue[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = getSandboxPropertyDescriptor(applyArgs, String(index), budget);
      if (descriptor !== undefined && !("value" in descriptor)) break;
      values.push(descriptor?.value);
    }
    if (values.length === length) {
      for (let index = 0; index < length; index++) budget.visitNode();
      return options.callClosure(target, values, stack, thisValue);
    }
  }

  return (async () => {
    const budget = options.budget ?? new Budget();
    const invocationContext: SandboxCallContext = {
      ...context,
      stack,
      thisValue: context?.thisValue,
      invokeClosure: context?.invokeClosure ?? ((callee, values, receiver) =>
        Promise.resolve(options.callClosure(callee, values, stack, receiver)))
    };
    const read = (value: SandboxValue, key: PropertyKey) => {
      if (context?.getProperty !== undefined) return context.getProperty(value, key);
      const descriptor = getSandboxPropertyDescriptor(value, key, budget);
      return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, invocationContext);
    };
    const values: SandboxValue[] = [];
    const release = retainValues(budget, () => [applyArgs, ...values]);
    try {
      const number = await sandboxNumber(await read(applyArgs, "length"), budget, invocationContext);
      const length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
      budget.allocateArrayLength(length);
      for (let index = 0; index < length; index++) {
        budget.visitNode();
        values.push(await read(applyArgs, String(index)));
      }
      return await options.callClosure(target, values, stack, thisValue);
    } finally {
      release();
    }
  })();
}
