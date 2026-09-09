import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import { createSharedArrayBufferStorage, isSandboxSharedArrayBuffer, sharedArrayBufferPrototypes, sharedArrayBufferStorage } from "../shared-array-buffer.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../values.js";

const growStorage = Reflect.get(SharedArrayBuffer.prototype,"grow") as ((length:number)=>void) | undefined;

export function createSharedArrayBufferGlobal(budget:Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest:true,sandbox:true,name:"SharedArrayBuffer",length:1,
    call:()=>{throw new TypeError("SharedArrayBuffer requires new.");},
    construct:async (args,context)=>{
      context=sharedBufferContext(context,budget);
      let selected:SandboxValue;
      let maximum:SandboxValue;
      const release=retainValues(budget,()=>[...args,selected,maximum]);
      try {
        const number=await sandboxNumber(args[0],budget,context);
        const length=Number.isNaN(number)?0:Math.trunc(number);
        if (!Number.isSafeInteger(length)||length<0) throw new RangeError("Invalid shared buffer length.");
        let capacity:number|undefined;
        if (args[1]!==null && typeof args[1]==="object") {
          maximum=await sandboxGetProperty(args[1],"maxByteLength",args[1],budget,context);
          if (maximum!==undefined) {
            const value=await sandboxNumber(maximum,budget,context);
            capacity=Number.isNaN(value)?0:Math.trunc(value);
            if (!Number.isSafeInteger(capacity)||capacity<length) throw new RangeError("Invalid shared buffer capacity.");
          }
        }
        const target=context?.newTarget??constructor;
        selected=await sandboxGetProperty(target,"prototype",target,budget,context);
        if (selected===null||typeof selected!=="object") selected=getFunctionRealmPrototype(target,"SharedArrayBuffer",prototype);
        const result=createSharedArrayBufferStorage(length,capacity,budget);
        setSandboxPrototype(result,selected,budget);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor),"prototype",{value:prototype,writable:false});
  Object.defineProperties(prototype,{
    constructor:{value:constructor,writable:true,configurable:true},
    [Symbol.toStringTag]:{value:"SharedArrayBuffer",configurable:true}
  });
  const species=createSandboxClosure({guest:true,sandbox:true,name:"get [Symbol.species]",length:0,
    call:(_args,context)=>context?.thisValue});
  Object.defineProperty(materializeFunctionProperties(constructor),Symbol.species,{get:accessorAdapter(species,"get"),configurable:true});
  const getters=[species];
  for (const key of ["byteLength","maxByteLength","growable"] as const) {
    const getter=createSandboxClosure({guest:true,sandbox:true,name:`get ${key}`,length:0,
      call:(_args,context)=>{
        if (!isSandboxSharedArrayBuffer(context?.thisValue)) throw new TypeError("Shared buffer getter requires shared storage.");
        return sharedArrayBufferStorage(context.thisValue)[key];
      }});
    Object.defineProperty(prototype,key,{get:accessorAdapter(getter,"get"),configurable:true});
    getters.push(getter);
  }
  Object.defineProperty(prototype,"grow",{writable:true,configurable:true,
    value:createSandboxClosure({guest:true,sandbox:true,name:"grow",length:1,
      call:async (args,context)=>{
        context=sharedBufferContext(context,budget);
        const receiver=context?.thisValue;
        if (!isSandboxSharedArrayBuffer(receiver)||!sharedArrayBufferStorage(receiver).growable||growStorage===undefined)
          throw new TypeError("Shared buffer growth requires growable storage.");
        const release=retainValues(budget,()=>[receiver,...args]);
        try {
          const value=await sandboxNumber(args[0],budget,context);
          const length=Number.isNaN(value)?0:Math.trunc(value);
          const storage=sharedArrayBufferStorage(receiver);
          if (!Number.isSafeInteger(length)||length<storage.byteLength||length>storage.maxByteLength)
            throw new RangeError("Invalid shared buffer growth length.");
          budget.allocateArrayLength(length);
          budget.provisionDataUsage(length-storage.byteLength)();
          Reflect.apply(growStorage,receiver,[length]);
          return undefined;
        } finally { release(); }
      }})});
  Object.defineProperty(prototype,"slice",{writable:true,configurable:true,
    value:createSandboxClosure({guest:true,sandbox:true,name:"slice",length:2,
      call:async (args,context)=>{
        context=sharedBufferContext(context,budget);
        const receiver=context?.thisValue;
        if (!isSandboxSharedArrayBuffer(receiver)) throw new TypeError("Shared buffer slice requires shared storage.");
        const storage=sharedArrayBufferStorage(receiver);
        let candidate:SandboxValue;
        let result:SandboxValue;
        const release=retainValues(budget,()=>[receiver,...args,candidate,result]);
        const clamp=(value:number)=>{
          const integer=Number.isNaN(value)?0:Math.trunc(value);
          return integer<0?Math.max(storage.byteLength+integer,0):Math.min(integer,storage.byteLength);
        };
        try {
          const start=clamp(await sandboxNumber(args[0],budget,context));
          const end=args[1]===undefined?storage.byteLength:clamp(await sandboxNumber(args[1],budget,context));
          const length=Math.max(end-start,0);
          candidate=await sandboxGetProperty(receiver,"constructor",receiver,budget,context);
          if (candidate!==undefined) {
            if (candidate===null||typeof candidate!=="object") throw new TypeError("Invalid shared buffer constructor.");
            candidate=await sandboxGetProperty(candidate,Symbol.species,candidate,budget,context);
          }
          if (candidate===undefined||candidate===null||candidate===constructor) {
            result=createSharedArrayBufferStorage(length,undefined,budget);
            setSandboxPrototype(result as object,prototype,budget);
          } else {
            if (!isSandboxClosure(candidate)||candidate.construct===undefined) throw new TypeError("Shared buffer species must be a constructor.");
            result=await invokeBuiltinClosure(candidate,[length],budget,context,undefined,true);
          }
          if (!isSandboxSharedArrayBuffer(result)) throw new TypeError("Shared buffer species must return shared storage.");
          const output=sharedArrayBufferStorage(result);
          if (output.block===storage.block||output.byteLength<length) throw new TypeError("Shared buffer species must return distinct sufficient storage.");
          budget.visitNode(length);
          new Uint8Array(result,0,length).set(new Uint8Array(receiver,start,length));
          return result;
        } finally { release(); }
      }})});
  setSandboxPrototype(prototype,getSandboxPrototype(Object.create(null),budget));
  sharedArrayBufferPrototypes.set(budget,prototype);
  registerBuiltinIdentities(budget,{SharedArrayBuffer:constructor});
  registerIntrinsicFunction(budget,constructor);
  for (const getter of getters) registerIntrinsicFunction(budget,getter);
  registerIntrinsicObject(budget,prototype);
  return constructor;
}

function sharedBufferContext(context:SandboxCallContext|undefined,budget:Budget):SandboxCallContext {
  const caller:SandboxCallContext={...context,stack:context?.stack??[],thisValue:context?.thisValue};
  const bridge:SandboxCallContext={...caller,
    invokeClosure:context?.invokeClosure??((callee,args,receiver,construct,newTarget)=>
      invokeBuiltinClosure(callee,args,budget,caller,receiver,construct,newTarget)),
    getProperty:context?.getProperty??((value,key)=>sandboxGetProperty(value,key,value,budget,bridge))};
  return bridge;
}
