import type { Budget } from "../budget.js";
import { sandboxIsExtensible, sandboxPreventExtensions } from "../guest-proxy-extensibility.js";
import { sandboxGetPrototypeOf, sandboxSetPrototypeOf } from "../guest-proxy-prototype.js";
import { sandboxGetOwnPropertyDescriptor } from "../guest-proxy-descriptor.js";
import { sandboxDeleteProperty } from "../guest-proxy-delete.js";
import { sandboxHasProperty } from "../guest-proxy-has.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { sandboxSetProperty } from "../guest-proxy-set.js";
import { sandboxOwnKeys } from "../guest-proxy-own-keys.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, registerIntrinsicFunction, registerIntrinsicObject } from "../object-model.js";
import { toPropertyKey } from "../property-key.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxObject, type SandboxValue } from "../values.js";
import { defineDataProperty, exposePropertyDescriptor, objectProperties, propertyDescriptor } from "./object-array.js";
import { callFunctionMethod } from "../methods/function.js";

const nativeReflectPropertyNames = Object.getOwnPropertyNames(Reflect);

export function createReflectGlobal(budget: Budget): SandboxObject {
  const methods: Record<string, { length: number; call(args: readonly SandboxValue[], context: SandboxCallContext): SandboxValue | Promise<SandboxValue> }> = {
    ownKeys: { length: 1, call: async ([target], context) => {
      return allocateProducedSandboxValue(await sandboxOwnKeys(target, budget, context), budget);
    } },
    getOwnPropertyDescriptor: { length: 2, call: async ([target, key], context) => {
      objectProperties(target);
      const property = await toPropertyKey(key, budget, context);
      const descriptor = await sandboxGetOwnPropertyDescriptor(target, property, budget, context);
      return descriptor === undefined ? undefined : allocateProducedSandboxValue(exposePropertyDescriptor(descriptor, budget), budget);
    } },
    getPrototypeOf: { length: 1, call: ([target], context) => sandboxGetPrototypeOf(target, budget, context) },
    has: { length: 2, call: async ([target, key], context) => {
      objectProperties(target);
      return sandboxHasProperty(target, await toPropertyKey(key, budget, context), budget, context);
    } },
    isExtensible: { length: 1, call: ([target], context) => sandboxIsExtensible(target, budget, context) },
    preventExtensions: { length: 1, call: ([target], context) => sandboxPreventExtensions(target, budget, context) },
    deleteProperty: { length: 2, call: async ([target, key], context) => {
      objectProperties(target, true);
      const property = await toPropertyKey(key, budget, context);
      return sandboxDeleteProperty(target, property, budget, context);
    } },
    get: { length: 2, call: async (args, context) => {
      const [target, key] = args;
      objectProperties(target);
      const property = await toPropertyKey(key, budget, context);
      return sandboxGetProperty(target, property, args.length > 2 ? args[2] : target, budget, context);
    } },
    defineProperty: { length: 3, call: async ([target, key, input], context) => {
      objectProperties(target,true);
      const property = await toPropertyKey(key,budget,context);
      const descriptor = await propertyDescriptor(input,budget,context);
      return await defineDataProperty(target,property,descriptor,budget,context,false);
    } },
    setPrototypeOf: { length: 2, call: ([target, prototype], context) => sandboxSetPrototypeOf(target, prototype, budget, context) },
    set: { length: 3, call: async (args,context) => {
      const [target,key,value] = args;
      objectProperties(target,true);
      const property = await toPropertyKey(key,budget,context);
      const receiver = args.length > 3 ? args[3] : target;
      return sandboxSetProperty(target, property, value, receiver, budget, context);
    } },
    apply: { length: 3, call: ([target,receiver,values],context) => {
      if (!isSandboxClosure(target)) throw new TypeError("Reflect.apply requires a callable target.");
      objectProperties(values);
      return callFunctionMethod(target,"apply",[receiver,values],{budget,
        callClosure:(callee,args,_stack,thisValue)=>context.invokeClosure!(callee,args,thisValue)
      },context.stack,context);
    } },
    construct: { length: 2, call: (args,context) => {
      const [target,values] = args;
      const newTarget = args.length > 2 ? args[2] : target;
      if (!isSandboxClosure(target) || target.construct === undefined || !isSandboxClosure(newTarget) || newTarget.construct === undefined)
        throw new TypeError("Reflect.construct requires constructor targets.");
      objectProperties(values);
      return callFunctionMethod(target,"apply",[undefined,values],{budget,
        callClosure:(callee,items)=>context.invokeClosure!(callee,items,undefined,true,newTarget)
      },context.stack,context);
    } }
  };
  const reflect = createIntrinsicObject({});
  for (const name of nativeReflectPropertyNames) {
    const method = methods[name];
    if (method === undefined) continue;
    const closure = createSandboxClosure({guest:true,sandbox:true,name,length:method.length,
      call: async (args, context) => {
        const release = retainValues(budget, () => args);
        try {
          const callerContext: SandboxCallContext = {
            ...context, stack: context?.stack ?? [], thisValue: context?.thisValue,
            getProperty: context?.getProperty ?? ((object, key) => sandboxGetProperty(object, key, object, budget, bridge))
          };
          const bridge: SandboxCallContext = { ...callerContext,
            invokeClosure: context?.invokeClosure ?? ((target, values, receiver, construct, newTarget) =>
              invokeBuiltinClosure(target, values, budget, callerContext, receiver, construct, newTarget)) };
          return await method.call(args, bridge);
        } finally { release(); }
      }
    });
    Object.defineProperty(reflect,name,{value:closure,writable:true,configurable:true});
  }
  Object.defineProperty(reflect,Symbol.toStringTag,{value:"Reflect",configurable:true});
  registerBuiltinIdentities(budget,{Reflect:reflect});
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(reflect))) {
    if (isSandboxClosure(descriptor.value)) registerIntrinsicFunction(budget,descriptor.value);
  }
  registerIntrinsicObject(budget,reflect);
  return reflect;
}
