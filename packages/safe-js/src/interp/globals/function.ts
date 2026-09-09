import type { Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { callFunctionMethod } from "../methods/function.js";
import { getSandboxPrototype, installFunctionPrototype, materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "../object-model.js";
import { createSandboxClosure } from "../values.js";
import { ordinaryHasInstance } from "../instanceof.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { accessorAdapter } from "../accessors.js";

export function createFunctionPrototype(budget: Budget, installHasInstance = true): void {
  const prototype = createSandboxClosure({ guest: true, sandbox: true, name: "", length: 0, call: () => undefined });
  const properties = materializeFunctionProperties(prototype);
  // Invocation support does not grant the host's dynamic source constructor.
  Object.defineProperty(properties, "constructor", { value: undefined, writable: true, configurable: true });
  const restricted = createSandboxClosure({ guest: true, sandbox: true, name: "", length: 0,
    call: () => { throw new TypeError("Restricted function property."); }
  });
  const restrictedProperties = materializeFunctionProperties(restricted);
  Object.defineProperties(restrictedProperties, {
    length: { configurable: false }, name: { configurable: false }
  });
  setSandboxPrototype(restricted, prototype);
  Object.preventExtensions(restrictedProperties);
  for (const name of ["arguments", "caller"]) Object.defineProperty(properties, name, {
    get: accessorAdapter(restricted, "get"), set: accessorAdapter(restricted, "set"), configurable: true
  });
  for (const [name, length] of [["call", 1], ["apply", 2], ["bind", 1], ["toString", 0]] as const) {
    Object.defineProperty(properties, name, { writable: true, configurable: true,
      value: createSandboxClosure({ guest: true, sandbox: true, name, length,
        call: (args, context) => callFunctionMethod(context?.thisValue, name, args, {
          budget,
          callClosure: (target, values, stack, thisValue, construct, newTarget) =>
            context?.invokeClosure !== undefined
              ? context.invokeClosure(target, values, thisValue, construct, newTarget)
              : invokeBuiltinClosure(target, values, budget, { ...context, stack, thisValue, newTarget }, thisValue, construct)
        }, context?.stack ?? [], context)
      })
    });
  }
  const hasInstance = installHasInstance ? createSandboxClosure({ guest: true, sandbox: true, name: "[Symbol.hasInstance]", length: 1,
    call: ([value], context) => ordinaryHasInstance(value, context?.thisValue, budget, context)
  }) : undefined;
  if (hasInstance !== undefined) Object.defineProperty(properties, Symbol.hasInstance, { value: hasInstance });
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  installFunctionPrototype(budget, prototype);
  registerBuiltinIdentities(budget, { "%ThrowTypeError%": restricted });
  registerIntrinsicFunction(budget, restricted);
  if (hasInstance !== undefined) registerIntrinsicFunction(budget, hasInstance);
}
