import type { Budget } from "../budget.js";
import { generatorPrototypes } from "../generator-prototypes.js";
import { registerBuiltinIdentities, resolveIntrinsicIdentity } from "../intrinsics.js";
import { callGeneratorMethod } from "../methods/generator.js";
import { createIntrinsicObject, getSandboxPrototype, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { createSandboxClosure, type SandboxObject } from "../values.js";
import { installAsyncIteratorDispose } from "./async-iterator-dispose.js";

export function createGeneratorPrototypes(budget: Budget): void {
  const asyncIteratorPrototype: SandboxObject = createIntrinsicObject();
  const asyncIterator = createSandboxClosure({ guest: true, sandbox: true,
    name: "[Symbol.asyncIterator]", length: 0, call: (_args, context) => context?.thisValue });
  Object.defineProperty(asyncIteratorPrototype, Symbol.asyncIterator, {
    value: asyncIterator, writable: true, configurable: true
  });
  setSandboxPrototype(asyncIteratorPrototype, getSandboxPrototype(Object.create(null), budget));
  installAsyncIteratorDispose(asyncIteratorPrototype, budget);
  registerBuiltinIdentities(budget, { "%AsyncIteratorPrototype%": asyncIteratorPrototype });
  registerIntrinsicObject(budget, asyncIteratorPrototype);
  registerIntrinsicFunction(budget, asyncIterator);

  const state = new Map<boolean, { functionPrototype: SandboxObject; instancePrototype: SandboxObject }>();
  for (const async of [false, true]) {
    const tag = async ? "AsyncGenerator" : "Generator";
    const functionPrototype: SandboxObject = createIntrinsicObject();
    const instancePrototype: SandboxObject = createIntrinsicObject();
    setSandboxPrototype(functionPrototype, resolveIntrinsicIdentity(budget, JSON.stringify(["%FunctionPrototype%"])));
    setSandboxPrototype(instancePrototype, async ? asyncIteratorPrototype
      : resolveIntrinsicIdentity(budget, JSON.stringify(["%IteratorPrototype%"])));
    Object.defineProperties(functionPrototype, {
      prototype: { value: instancePrototype, configurable: true },
      // Do not expose native dynamic-source constructors through this graph.
      constructor: { value: undefined, configurable: true },
      [Symbol.toStringTag]: { value: `${tag}Function`, configurable: true }
    });
    Object.defineProperties(instancePrototype, {
      constructor: { value: functionPrototype, configurable: true },
      [Symbol.toStringTag]: { value: tag, configurable: true }
    });
    for (const method of ["next", "return", "throw"] as const) {
      Object.defineProperty(instancePrototype, method, { writable: true, configurable: true,
        value: createSandboxClosure({ guest: true, sandbox: true, name: method, length: 1,
          call: ([value], context) => callGeneratorMethod(context?.thisValue, method, value, budget, context, async)
        })
      });
    }
    registerBuiltinIdentities(budget, {
      [`%${tag}Prototype%`]: instancePrototype,
      [`%${tag}FunctionPrototype%`]: functionPrototype
    });
    registerIntrinsicObject(budget, functionPrototype);
    registerIntrinsicObject(budget, instancePrototype);
    state.set(async, { functionPrototype, instancePrototype });
  }
  generatorPrototypes.set(budget, state);
}
