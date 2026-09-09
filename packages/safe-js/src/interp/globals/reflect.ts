import type { Budget } from "../budget.js";
import { sandboxIsExtensible, sandboxPreventExtensions } from "../guest-proxy-extensibility.js";
import { sandboxGetPrototypeOf, sandboxSetPrototypeOf } from "../guest-proxy-prototype.js";
import { isSandboxModuleNamespace } from "../module-namespace.js";
import { assertSandboxDataDepth } from "../../graph-depth.js";
import { accessorClosure, readPropertyDescriptor } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, getSandboxPrototype, registerIntrinsicFunction, registerIntrinsicObject } from "../object-model.js";
import { toPropertyKey } from "../property-key.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure, ownSandboxSymbolKeys, type SandboxCallContext, type SandboxObject, type SandboxValue } from "../values.js";
import { defineDataProperty, exposePropertyDescriptor, objectProperties, propertyDescriptor } from "./object-array.js";
import { callFunctionMethod } from "../methods/function.js";
import { isNumericTypedArray, isTypedArrayIndex } from "../typed-array.js";
import { setTypedArrayMember } from "./numeric-typed-array.js";

const nativeReflectPropertyNames = Object.getOwnPropertyNames(Reflect);

export function createReflectGlobal(budget: Budget): SandboxObject {
  const methods: Record<string, { length: number; call(args: readonly SandboxValue[], context: SandboxCallContext): SandboxValue | Promise<SandboxValue> }> = {
    ownKeys: { length: 1, call: ([target]) => {
      const properties = objectProperties(target);
      return allocateProducedSandboxValue([...Object.getOwnPropertyNames(properties), ...ownSandboxSymbolKeys(target)], budget);
    } },
    getOwnPropertyDescriptor: { length: 2, call: async ([target, key], context) => {
      objectProperties(target);
      const property = await toPropertyKey(key, budget, context);
      const descriptor = Object.getOwnPropertyDescriptor(objectProperties(target), property);
      return descriptor === undefined ? undefined : allocateProducedSandboxValue(exposePropertyDescriptor(descriptor, budget), budget);
    } },
    getPrototypeOf: { length: 1, call: ([target], context) => sandboxGetPrototypeOf(target, budget, context) },
    has: { length: 2, call: async ([target, key], context) => {
      objectProperties(target);
      return getSandboxPropertyDescriptor(target, await toPropertyKey(key, budget, context), budget) !== undefined;
    } },
    isExtensible: { length: 1, call: ([target], context) => sandboxIsExtensible(target, budget, context) },
    preventExtensions: { length: 1, call: ([target], context) => sandboxPreventExtensions(target, budget, context) },
    deleteProperty: { length: 2, call: async ([target, key], context) => {
      objectProperties(target, true);
      const property = await toPropertyKey(key, budget, context);
      return Reflect.deleteProperty(objectProperties(target, true), property);
    } },
    get: { length: 2, call: async (args, context) => {
      const [target, key] = args;
      objectProperties(target);
      const property = await toPropertyKey(key, budget, context);
      const descriptor = getSandboxPropertyDescriptor(target, property, budget);
      return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, args.length > 2 ? args[2] : target, context);
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
      let descriptor: PropertyDescriptor | undefined;
      let depth = 0;
      for (let current = target; current !== null; current = getSandboxPrototype(current as object,budget) as SandboxValue) {
        budget.visitNode();
        assertSandboxDataDepth(depth++);
        if (isSandboxModuleNamespace(current)) return false;
        if (isNumericTypedArray(current) && typeof property === "string" && isTypedArrayIndex(property)) {
          if (current === receiver) {
            await setTypedArrayMember(current,property,value,budget,context);
            return true;
          }
          if (Object.getOwnPropertyDescriptor(current,property) === undefined) return true;
        }
        descriptor = Object.getOwnPropertyDescriptor(objectProperties(current),property);
        if (descriptor !== undefined) break;
      }
      if (descriptor !== undefined && !("value" in descriptor)) {
        const setter = accessorClosure(descriptor.set);
        if (setter === undefined) return false;
        await context.invokeClosure!(setter,[value],receiver);
        return true;
      }
      if (descriptor !== undefined && !descriptor.writable) return false;
      if (receiver === null || typeof receiver !== "object") return false;
      const existing = Object.getOwnPropertyDescriptor(objectProperties(receiver,true),property);
      if (existing !== undefined && (!("value" in existing) || !existing.writable)) return false;
      return await defineDataProperty(receiver,property,existing === undefined
        ? {value,writable:true,enumerable:true,configurable:true} : {value},budget,context,false);
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
          return await method.call(args, { ...context, stack:context?.stack ?? [], thisValue:context?.thisValue,
            invokeClosure: context?.invokeClosure ?? ((target, values, receiver, construct, newTarget) =>
              invokeBuiltinClosure(target, values, budget, {...context,stack:context?.stack ?? [],thisValue:receiver,newTarget}, receiver, construct)) });
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
