import type { Budget } from "../budget.js";
import {
  createSandboxBox,
  primitiveReceiver,
  type BoxedKind,
  type BoxedPrimitive
} from "../boxed.js";
import { createIntrinsicObject, installBoxedPrototype, materializeFunctionProperties, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { registerBuiltinIdentities, resolveIntrinsicIdentity } from "../intrinsics.js";
import { nextStringIterator, restoreSandboxStringIterator } from "../string-iterator.js";
import { sandboxString } from "../string-coercion.js";
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
    const finish = (selectedPrototype: SandboxValue) => {
      budget.chargeDataUsage(measureSandboxData([box]));
      setSandboxPrototype(box,
        typeof selectedPrototype === "object" && selectedPrototype !== null ? selectedPrototype : prototype,
        budget);
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
        guest: true,
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
        guest: true,
        name: "toString",
        length: 0,
        call: (_args, context) =>
          budget.allocateString(String(primitiveReceiver(context?.thisValue, kind)))
      })
    );
    if (kind === "string") {
      for (const name of stringMethodNames) methods.set(name, getStringMember("", name, budget));
      methods.set("trimLeft", methods.get("trimStart")!);
      methods.set("trimRight", methods.get("trimEnd")!);
    }
  }
  for (const [name, value] of methods)
    Object.defineProperty(prototype, name, { value, writable: true, configurable: true });
  if (kind === "string") {
    const iteratorPrototype: SandboxObject = createIntrinsicObject();
    setSandboxPrototype(iteratorPrototype, resolveIntrinsicIdentity(budget, '["%IteratorPrototype%"]'));
    Object.defineProperties(iteratorPrototype, {
      next: { value: createSandboxClosure({ guest: true, sandbox: true, name: "next", length: 0,
        call: (_args, context) => nextStringIterator(context?.thisValue, budget)
      }), writable: true, configurable: true },
      [Symbol.toStringTag]: { value: "String Iterator", configurable: true }
    });
    registerBuiltinIdentities(budget, { "%StringIteratorPrototype%": iteratorPrototype });
    registerIntrinsicObject(budget, iteratorPrototype);
    Object.defineProperty(prototype, Symbol.iterator, { value: createSandboxClosure({
      guest: true, sandbox: true, name: "[Symbol.iterator]", length: 0,
      call: async (_args, context) => {
        const receiver = context?.thisValue;
        if (receiver === null || receiver === undefined) throw new TypeError("String iterator requires a receiver.");
        const input = await sandboxString(receiver, budget, context);
        const iterator = restoreSandboxStringIterator({ input, index: 0 });
        setSandboxPrototype(iterator, iteratorPrototype, budget);
        return iterator;
      }
    }), writable: true, configurable: true });
  }
  installBoxedPrototype(budget, prototype, constructor);
  return constructor;
}
