import type { Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { callFunctionMethod } from "../methods/function.js";
import { completeIntrinsicObjectInitialization, createIntrinsicObject, getSandboxPrototype, installFunctionPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { ordinaryHasInstance } from "../instanceof.js";
import { sandboxString } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import type { DynamicFunctionKind } from "../../parse/parser.js";
import { asyncFunctionPrototypes, generatorPrototypes } from "../generator-prototypes.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { accessorAdapter } from "../accessors.js";

export function createFunctionPrototype(budget: Budget, installHasInstance = true) {
  const prototype = createSandboxClosure({ guest: true, sandbox: true, name: "", length: 0, call: () => undefined });
  const properties = materializeFunctionProperties(prototype);
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
              : invokeBuiltinClosure(target, values, budget, { ...context, stack, thisValue, newTarget }, thisValue, construct, newTarget)
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
  return createDynamicConstructor(budget, "normal", "Function", prototype);
}

export function installDynamicFunctionConstructors(budget: Budget, functionConstructor: SandboxClosure): void {
  const asyncPrototype = createIntrinsicObject();
  Object.defineProperty(asyncPrototype, Symbol.toStringTag, {value: "AsyncFunction", configurable: true});
  setSandboxPrototype(asyncPrototype, getSandboxPrototype(functionConstructor, budget));
  asyncFunctionPrototypes.set(budget, asyncPrototype);
  registerIntrinsicObject(budget, asyncPrototype);
  registerBuiltinIdentities(budget, {"%AsyncFunctionPrototype%": asyncPrototype});
  for (const [kind, name, prototype] of [
    ["async", "AsyncFunction", asyncPrototype],
    ["generator", "GeneratorFunction", generatorPrototypes.get(budget)!.get(false)!.functionPrototype],
    ["async-generator", "AsyncGeneratorFunction", generatorPrototypes.get(budget)!.get(true)!.functionPrototype]
  ] as const) {
    const constructor = createDynamicConstructor(budget, kind, name, prototype);
    setSandboxPrototype(constructor, functionConstructor);
    completeIntrinsicObjectInitialization(budget, constructor);
    registerBuiltinIdentities(budget, {[`%${name}%`]: constructor});
  }
}

function createDynamicConstructor(budget: Budget, kind: DynamicFunctionKind, name: string, prototype: SandboxObject | SandboxClosure): SandboxClosure {
  const invoke = async (args: readonly SandboxValue[], context?: SandboxCallContext) => {
    if (context?.createDynamicFunction === undefined) throw new TypeError("Dynamic functions require a guest execution context.");
    const strings: string[] = [];
    let closure: SandboxClosure | undefined;
    let body = "";
    const release = retainValues(budget, () => [...args, ...strings, body, closure]);
    try {
      for (const value of args) strings.push(await sandboxString(value, budget, context));
      body = strings.pop() ?? "";
      closure = context.createDynamicFunction(kind, strings.join(","), body);
      const target = context.newTarget ?? constructor;
      const targetPrototype = context.getProperty === undefined
        ? materializeFunctionProperties(target).prototype
        : await context.getProperty(target, "prototype");
      setSandboxPrototype(closure, typeof targetPrototype === "object" && targetPrototype !== null ? targetPrototype : prototype, budget);
      return closure;
    } finally { release(); }
  };
  const constructor = createSandboxClosure({guest: true, sandbox: true, name, length: 1, call: invoke, construct: invoke});
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", {value: prototype, writable: false});
  Object.defineProperty(isSandboxClosure(prototype) ? materializeFunctionProperties(prototype) : prototype, "constructor", {
    value: constructor, writable: kind === "normal", configurable: true
  });
  completeIntrinsicObjectInitialization(budget, prototype);
  if (isSandboxClosure(prototype)) completeIntrinsicObjectInitialization(budget, materializeFunctionProperties(prototype));
  registerIntrinsicFunction(budget, constructor);
  return constructor;
}
