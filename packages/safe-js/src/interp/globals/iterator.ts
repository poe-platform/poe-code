import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { sandboxGetOwnPropertyDescriptor } from "../guest-proxy-descriptor.js";
import { wellKnownSymbols } from "../symbols.js";
import { resolveIntrinsicIdentity } from "../intrinsics.js";
import { setSandboxProperty } from "../interpreter.js";
import { completeIntrinsicObjectInitialization, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "../values.js";
import { defineDataProperty } from "./object-array.js";
import { installIteratorFrom } from "./iterator-from.js";
import { installIteratorConsumers } from "./iterator-consumers.js";
import { installLazyIteratorHelpers } from "./iterator-lazy.js";

export function createIteratorGlobal(budget: Budget): SandboxClosure {
  const prototype = resolveIntrinsicIdentity(budget, '["%IteratorPrototype%"]') as SandboxObject;
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "Iterator", length: 0,
    call: () => { throw new TypeError("Iterator is an abstract constructor."); },
    construct: async (_args, context) => {
      const target = context?.newTarget;
      if (target === undefined || target === constructor)
        throw new TypeError("Iterator is an abstract constructor.");
      const caller: SandboxCallContext = {
        ...context, stack: context?.stack ?? [], thisValue: undefined,
        getProperty: context?.getProperty ?? ((value,key)=>sandboxGetProperty(value,key,value,budget,bridge))
      };
      const bridge: SandboxCallContext = {
        ...caller,
        invokeClosure: context?.invokeClosure ?? ((callee,args,receiver,construct,newTarget)=>
          invokeBuiltinClosure(callee,args,budget,caller,receiver,construct,newTarget))
      };
      const candidate = await bridge.getProperty!(target, "prototype");
      const parent = candidate !== null && typeof candidate === "object" ? candidate
        : getFunctionRealmPrototype(target, "Iterator", prototype);
      const instance: SandboxObject = Object.create(null);
      setSandboxPrototype(instance, parent !== null && typeof parent === "object" ? parent : prototype, budget);
      createDataCheckpoint(budget, context)(instance, 0, true);
      return instance;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", {value:prototype,writable:false});
  const getter = createSandboxClosure({guest:true,sandbox:true,name:"get constructor",length:0,call:()=>constructor});
  const setter = createSandboxClosure({guest:true,sandbox:true,name:"set constructor",length:1,call:async ([value],context)=>{
    const receiver=context?.thisValue;
    if (receiver === prototype || receiver === null || typeof receiver !== "object")
      throw new TypeError("Iterator constructor setter requires a distinct object receiver.");
    const descriptor = await sandboxGetOwnPropertyDescriptor(receiver, "constructor", budget, context);
    if (descriptor !== undefined) await setSandboxProperty(receiver,"constructor",value,budget,true,context);
    else await defineDataProperty(receiver, "constructor", {
      value, writable: true, enumerable: true, configurable: true
    }, budget, context);
    createDataCheckpoint(budget,context)(receiver,0,true);
    return undefined;
  }});
  Object.defineProperty(prototype,"constructor",{get:accessorAdapter(getter,"get"),set:accessorAdapter(setter,"set"),configurable:true});
  registerIntrinsicFunction(budget,getter);
  registerIntrinsicFunction(budget,setter);
  const dispose = createSandboxClosure({
    guest: true, sandbox: true, name: "[Symbol.dispose]", length: 0,
    call: async (_args, context) => {
      const receiver = context?.thisValue;
      if (receiver === null || receiver === undefined) throw new TypeError("Cannot read return from a nullish receiver.");
      const caller: SandboxCallContext = {
        ...context, stack: context?.stack ?? [], thisValue: receiver,
        getProperty: context?.getProperty ?? ((value,key)=>sandboxGetProperty(value,key,value,budget,bridge))
      };
      const bridge: SandboxCallContext = {
        ...caller,
        invokeClosure: context?.invokeClosure ?? ((callee,args,target,construct,newTarget)=>
          invokeBuiltinClosure(callee,args,budget,caller,target,construct,newTarget))
      };
      const method = await bridge.getProperty!(receiver, "return");
      if (method === undefined || method === null) return undefined;
      if (!isSandboxClosure(method)) throw new TypeError("Iterator return must be callable.");
      await invokeBuiltinClosure(method, [], budget, bridge, receiver);
      return undefined;
    }
  });
  Object.defineProperty(prototype, wellKnownSymbols.dispose, {value: dispose, writable: true, configurable: true});
  registerIntrinsicFunction(budget, dispose);
  installIteratorFrom(constructor,budget);
  installIteratorConsumers(prototype,budget);
  installLazyIteratorHelpers(prototype,budget,constructor);
  registerIntrinsicFunction(budget,constructor);
  completeIntrinsicObjectInitialization(budget, prototype);
  registerIntrinsicObject(budget,prototype);
  return constructor;
}
