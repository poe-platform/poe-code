import type { Budget } from "../budget.js";
import {
  createSandboxBox,
  primitiveReceiver,
  type BoxedKind,
  type BoxedPrimitive
} from "../boxed.js";
import { installBoxedPrototype, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { getNumberMember, numberMethodNames } from "../methods/number.js";
import { getStringMember, stringMethodNames } from "../methods/string.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  measureSandboxData,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";

export function createPrimitiveConstructor(
  options: {
    name: "Number" | "String" | "Boolean";
    call(
      args: readonly SandboxValue[],
      context?: SandboxCallContext
    ): BoxedPrimitive | Promise<BoxedPrimitive>;
    properties?: SandboxObject;
  },
  budget: Budget
): SandboxClosure {
  const initial: BoxedPrimitive = { Number: 0, String: "", Boolean: false }[options.name];
  const kind = typeof initial as BoxedKind;
  const prototype = createSandboxBox(initial);
  const allocate = (value: BoxedPrimitive, context?: SandboxCallContext) => {
    const box = createSandboxBox(value);
    const finish = (prototype: SandboxValue) => {
      if (typeof prototype === "object" && prototype !== null)
        setSandboxPrototype(box, prototype, budget);
      budget.chargeDataUsage(measureSandboxData([box]));
      return box;
    };
    if (context?.newTarget !== undefined && context.newTarget !== constructor) {
      const prototype = context.getProperty!(context.newTarget, "prototype");
      return prototype instanceof Promise ? prototype.then(finish) : finish(prototype);
    }
    return finish(undefined);
  };
  const constructor = createSandboxClosure({
    guest: true,
    sandbox: true,
    name: options.name,
    length: 1,
    call: options.call,
    construct: (args, context) => {
      const value = options.call(args, context);
      return value instanceof Promise
        ? value.then((result) => allocate(result, context))
        : allocate(value, context);
    }
  });
  const properties = materializeFunctionProperties(constructor);
  Object.defineProperty(properties, "prototype", { value: prototype, writable: false });
  Object.defineProperty(prototype, "constructor", {
    value: constructor,
    writable: true,
    configurable: true
  });
  for (const [name, value] of Object.entries(options.properties ?? {}))
    Object.defineProperty(properties, name, {
      value,
      writable: isSandboxClosure(value),
      configurable: isSandboxClosure(value)
    });
  const methods = new Map<string, SandboxValue>([
    [
      "valueOf",
      createSandboxClosure({
        sandbox: true,
        name: "valueOf",
        length: 0,
        call: (_args, context) => primitiveReceiver(context?.thisValue, kind)
      })
    ]
  ]);
  if (kind === "number") {
    for (const name of numberMethodNames) methods.set(name, getNumberMember(name, budget));
  } else {
    methods.set(
      "toString",
      createSandboxClosure({
        sandbox: true,
        name: "toString",
        length: 0,
        call: (_args, context) =>
          budget.allocateString(String(primitiveReceiver(context?.thisValue, kind)))
      })
    );
    if (kind === "string")
      for (const name of stringMethodNames) methods.set(name, getStringMember("", name, budget));
  }
  for (const [name, value] of methods)
    Object.defineProperty(prototype, name, { value, writable: true, configurable: true });
  installBoxedPrototype(budget, prototype, constructor);
  return constructor;
}
