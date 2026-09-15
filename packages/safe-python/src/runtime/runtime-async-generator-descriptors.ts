import {createRuntimeAsyncGeneratorOperation} from "./runtime-async-generator-operation.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {RuntimeValue,RuntimeValues,TypeValue,BuiltinInvocationContext} from "./runtime-values.js";
import {RuntimeGeneratorThrowRequest} from "./runtime-generator-throw-request.js";

/** Native async-generator and asend slots. The operation owns cross-await
 * exclusion; the underlying execution owns frames and handled exceptions. */
export function installRuntimeAsyncGeneratorDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,operationType:(kind:"async_generator_asend"|"async_generator_athrow")=>TypeValue):void {
  meter.checkpoint(0,256);
  const kind=owner.value.name;
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind===kind;
  if(kind==="async_generator") {
    for(const name of ["__aiter__","__anext__","asend","athrow","aclose"] as const) {
      meter.checkpoint(0,96);
      const descriptor={owner,name,accepts,
        invoke(receiver:RuntimeValue,positional:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext) {
          meter.checkpoint();
          if(keywords.items.size)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`async_generator.${name}() takes no keyword arguments`);
          const count=name==="asend"?1:0;
          if(name!=="athrow"&&positional.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${positional.length}`:`async_generator.${name}() takes ${count===0?"no arguments":"exactly one argument"} (${positional.length} given)`);
          if(name==="__aiter__")return receiver;
          if(receiver.kind!=="instance"||receiver.native?.kind!=="async_generator")throw Error("async generator requires native storage");
          if(name==="athrow") {
            if(invocation===undefined)throw Error("async generator throw requires invocation policy");
            if(positional.length>1)invocation.warn?.("DeprecationWarning","the (type, exc, tb) signature of athrow() is deprecated, use the single-arg signature instead.");
          }
          meter.checkpoint(0,64);
          const request=name==="athrow"?{kind:"throw" as const,error:new RuntimeGeneratorThrowRequest(positional,invocation!,meter,false)}:name==="aclose"?{kind:"close" as const}:{kind:"send" as const,value:name==="asend"?positional[0]:values.none};
          const operation=createRuntimeAsyncGeneratorOperation(receiver.native,request,values,meter);
          const operationKind=name==="athrow"||name==="aclose"?"async_generator_athrow":"async_generator_asend";
          return values.instance(operationType(operationKind),undefined,Object.freeze({kind:operationKind,generator:receiver,operation}));
        }
      };
      owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
    }
    for(const name of ["ag_running","ag_await"] as const) {
      meter.checkpoint(0,96);
      const descriptor={owner,name,accepts,get(receiver:RuntimeValue){
        if(receiver.kind!=="instance"||receiver.native?.kind!=="async_generator")throw Error("async generator requires native storage");
        return name==="ag_running"?values.boolean(receiver.native.activity.running):receiver.native.execution.yieldFrom;
      }};
      owner.value.namespace.items.set(values.string(name),name==="ag_running"?values.memberDescriptor(descriptor):values.getsetDescriptor(descriptor));
    }
    return;
  }
  for(const name of ["__iter__","__await__","__next__","send","throw","close"] as const) {
    meter.checkpoint(0,96);
    const descriptor={owner,name,accepts,
      invoke(receiver:RuntimeValue,positional:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext) {
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`${kind}.${name}() takes no keyword arguments`);
        const count=name==="send"?1:0;
        if(name!=="throw"&&positional.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${positional.length}`:`${kind}.${name}() takes ${count===0?"no arguments":"exactly one argument"} (${positional.length} given)`);
        if(name==="__iter__"||name==="__await__")return receiver;
        if(receiver.kind!=="instance"||(receiver.native?.kind!=="async_generator_asend"&&receiver.native?.kind!=="async_generator_athrow")||receiver.native.generator.native?.kind!=="async_generator")throw Error("async generator operation requires native storage");
        const {operation,generator}=receiver.native;
        if(name==="throw"&&invocation===undefined)throw Error("async generator throw requires invocation policy");
        const result=operation.resume(name==="throw"?{kind:"throw",error:new RuntimeGeneratorThrowRequest(positional,invocation!,meter)}:name==="close"?{kind:"close"}:{kind:"send",value:name==="send"?positional[0]:values.none});
        if(result.done&&name!=="close") {
          if(generator.native?.kind!=="async_generator")throw Error("async generator send lost its owner");
          // A suspended body completed this operation by yielding an item,
          // including explicit None. Closed-body completion has no argument.
          throw generator.native.exceptions.completion(result.value,generator.native.execution.phase==="suspended");
        }
        return result.value;
      }
    };
    owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
  }
}
