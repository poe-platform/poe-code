import { isFatalSandboxError, type Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { closeIterator, type SandboxIterator } from "../iteration.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { registerIntrinsicObject } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

export function installIteratorConsumers(prototype: SandboxObject,budget: Budget): void {
  for (const name of ["toArray","reduce","forEach","some","every","find"] as const) {
    Object.defineProperty(prototype,name,{writable:true,configurable:true,value:createSandboxClosure({
      guest:true,sandbox:true,name,length:name === "toArray" ? 0 : 1,
      call:async (args,context)=>{
        const receiver=context?.thisValue;
        if (receiver === null || typeof receiver !== "object") throw new TypeError("Iterator consumer requires an object.");
        const caller: SandboxCallContext = {
          ...context, stack: context?.stack ?? [], thisValue: receiver,
          getProperty: context?.getProperty ?? ((value,key)=>sandboxGetProperty(value,key,value,budget,bridge))
        };
        const bridge: SandboxCallContext = {
          ...caller,
          invokeClosure: context?.invokeClosure ?? ((callee,args,target,construct,newTarget)=>
            invokeBuiltinClosure(callee,args,budget,caller,target,construct,newTarget))
        };
        context=bridge;
        const callback=args[0];
        let next: SandboxValue;
        let accumulator: SandboxValue=args[1];
        let value: SandboxValue;
        const values: SandboxValue[]=[];
        const release=retainValues(budget,()=>[receiver,callback,next,accumulator,value,values]);
        const checkpoint=createDataCheckpoint(budget,context);
        const iterator: SandboxIterator={
          asynchronous:true,
          next:async ()=>{
            if (!isSandboxClosure(next)) throw new TypeError("Iterator next must be callable.");
            const result=await invokeBuiltinClosure(next,[],budget,context,receiver);
            if (result === null || typeof result !== "object") throw new TypeError("Iterator result must be an object.");
            // Protocol results are guest objects; done/value are read observably below.
            return result as unknown as IteratorResult<SandboxValue>;
          },
          getOperation:async ()=>{
            const method=await bridge.getProperty!(receiver,"return");
            if (method === undefined || method === null) return undefined;
            if (!isSandboxClosure(method)) throw new TypeError("Iterator return must be callable.");
            return async ()=>await invokeBuiltinClosure(method,[],budget,context,receiver) as unknown as IteratorResult<SandboxValue>;
          }
        };
        try {
          if (name !== "toArray" && !isSandboxClosure(callback)) {
            await closeIterator(iterator,true);
            throw new TypeError("Iterator callback must be callable.");
          }
          next=await bridge.getProperty!(receiver,"next");
          let initialized=name !== "reduce" || args.length>1;
          let index=0;
          while (true) {
            budget.visitNode();
            const result=await iterator.next();
            if (await bridge.getProperty!(result as unknown as SandboxValue,"done")) {
              if (!initialized) throw new TypeError("Cannot reduce an empty iterator without an initial value.");
              if (name === "toArray") return values;
              if (name === "reduce") return accumulator;
              if (name === "some") return false;
              if (name === "every") return true;
              return undefined;
            }
            value=await bridge.getProperty!(result as unknown as SandboxValue,"value");
            if (name === "toArray") {
              values.push(value);
              checkpoint(values,0,true);
            } else if (!initialized) {
              accumulator=value;
              initialized=true;
            } else {
              let selected: SandboxValue;
              try {
                selected=await invokeBuiltinClosure(callback as SandboxClosure,
                  name === "reduce" ? [accumulator,value,index] : [value,index],budget,context,undefined);
              } catch(error) {
                if (!isFatalSandboxError(error)) await closeIterator(iterator,true);
                throw error;
              }
              if (name === "reduce") accumulator=selected;
              else if ((name === "some" || name === "find") && selected || name === "every" && !selected) {
                await closeIterator(iterator);
                return name === "find" ? value : name === "some";
              }
            }
            value=undefined;
            index++;
          }
        } finally {release()}
      }
    })});
  }
  registerBuiltinIdentities(budget,{"%IteratorPrototype%":prototype});
  registerIntrinsicObject(budget,prototype);

}
