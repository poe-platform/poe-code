import type { Budget } from "../budget.js";
import { createSandboxBox } from "../boxed.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { ordinaryHasInstance } from "../instanceof.js";
import { registerBuiltinIdentities, resolveIntrinsicIdentity } from "../intrinsics.js";
import { iteratorWrapperStates } from "../iterator-wrapper.js";
import { createIntrinsicObject, getBoxedPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createIteratorResult } from "../iterator-result.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

export function installIteratorFrom(constructor: SandboxClosure, budget: Budget): void {
  const stringPrototype = getBoxedPrototype("", budget);
  const prototype: SandboxObject = createIntrinsicObject();
  setSandboxPrototype(prototype, resolveIntrinsicIdentity(budget, '["%IteratorPrototype%"]'));
  for (const name of ["next", "return"] as const) {
    Object.defineProperty(prototype, name, {writable:true,configurable:true,value:createSandboxClosure({
      guest:true,sandbox:true,name,length:0,call:async (_args,context)=>{
        const receiver=context?.thisValue;
        context=callContext(context);
        const state=receiver !== null && typeof receiver === "object" ? iteratorWrapperStates.get(receiver) : undefined;
        if (state === undefined) throw new TypeError("Iterator wrapper method requires a branded receiver.");
        const method=name === "next" ? state.next : await context.getProperty!(state.iterator,"return");
        if (name === "return" && (method === undefined || method === null)) return createIteratorResult(undefined,true,budget);
        if (!isSandboxClosure(method)) throw new TypeError("Iterator method must be callable.");
        return invokeBuiltinClosure(method,[],budget,context,state.iterator);
      }
    })});
  }
  const from=createSandboxClosure({guest:true,sandbox:true,name:"from",length:1,call:async ([input],context)=>{
    context=callContext(context);
    if (input === null || (typeof input !== "object" && typeof input !== "string"))
      throw new TypeError("Iterator.from requires an object or string.");
    let iterator: SandboxValue=input;
    let next: SandboxValue;
    const release=retainValues(budget,()=>[input,iterator,next]);
    try {
      const method=await context.getProperty!(input,Symbol.iterator);
      if (method !== undefined && method !== null) {
        if (!isSandboxClosure(method)) throw new TypeError("Symbol.iterator must be callable.");
        iterator=await invokeBuiltinClosure(method,[],budget,context,input);
      }
      if (iterator === null || typeof iterator !== "object") throw new TypeError("Iterator must be an object.");
      next=await context.getProperty!(iterator,"next");
      if (await ordinaryHasInstance(iterator,constructor,budget,context)) return iterator;
      const wrapper: SandboxObject=Object.create(null);
      iteratorWrapperStates.set(wrapper,{iterator,next});
      setSandboxPrototype(wrapper,prototype,budget);
      createDataCheckpoint(budget,context)(wrapper,0,true);
      return wrapper;
    } finally {release()}
  }});
  Object.defineProperty(materializeFunctionProperties(constructor),"from",{value:from,writable:true,configurable:true});
  registerBuiltinIdentities(budget,{Iterator:constructor,"%WrapForValidIteratorPrototype%":prototype});
  registerIntrinsicFunction(budget,from);
  registerIntrinsicObject(budget,prototype);

  function callContext(context?: SandboxCallContext): SandboxCallContext {
    const caller: SandboxCallContext = {
      ...context, stack: context?.stack ?? [], thisValue: context?.thisValue,
      getProperty: context?.getProperty ?? ((value,key)=>{
        if (typeof value !== "string") return sandboxGetProperty(value,key,value,budget,bridge);
        const box = createSandboxBox(value);
        setSandboxPrototype(box, stringPrototype ?? null, budget);
        return sandboxGetProperty(box,key,value,budget,bridge);
      })
    };
    const bridge: SandboxCallContext = {
      ...caller,
      invokeClosure: context?.invokeClosure ?? ((callee,args,receiver,construct,newTarget)=>
        invokeBuiltinClosure(callee,args,budget,caller,receiver,construct,newTarget))
    };
    return bridge;
  }
}
