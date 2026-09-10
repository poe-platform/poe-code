import {AsyncGeneratorSend} from "./async-generator-send.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {RuntimeValue,RuntimeValues,TypeValue,BuiltinInvocationContext} from "./runtime-values.js";
import {RuntimeGeneratorThrowRequest} from "./runtime-generator-throw-request.js";

/** Native async-generator and asend slots. The operation owns cross-await
 * exclusion; the underlying execution owns frames and handled exceptions. */
export function installRuntimeAsyncGeneratorDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,sendType:()=>TypeValue):void {
  meter.checkpoint(0,256);
  const kind=owner.value.name;
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind===kind;
  if(kind==="async_generator") {
    for(const name of ["__aiter__","__anext__","asend"] as const) {
      meter.checkpoint(0,96);
      const descriptor={owner,name,accepts,
        invoke(receiver:RuntimeValue,positional:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter) {
          meter.checkpoint();
          if(keywords.items.size)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`async_generator.${name}() takes no keyword arguments`);
          const count=name==="asend"?1:0;
          if(positional.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${positional.length}`:`async_generator.asend() takes exactly one argument (${positional.length} given)`);
          if(name==="__aiter__")return receiver;
          if(receiver.kind!=="instance"||receiver.native?.kind!=="async_generator")throw Error("async generator requires native storage");
          const state=receiver.native,{execution,exceptions}=state;
          meter.checkpoint(0,192);
          const operation=new AsyncGeneratorSend<RuntimeValue>({
            get delegating(){return execution.delegating;},
            resume(input) {
              if(input.kind==="throw"&&input.error instanceof RuntimeGeneratorThrowRequest) {
                const args=input.error.arguments,invocation=input.error.invocation;
                if(args.length<1)throw new PythonRuntimeError("TypeError","throw expected at least 1 argument, got 0");
                if(args.length>3)throw new PythonRuntimeError("TypeError",`throw expected at most 3 arguments, got ${args.length}`);
                if(args.length>1)invocation.warn?.("DeprecationWarning","the (type, exc, tb) signature of throw() is deprecated, use the single-arg signature instead.");
                meter.checkpoint();
                if(!execution.delegating) {
                  if(args.length===3&&args[2].kind!=="none")throw new PythonRuntimeError("TypeError","throw() third argument must be a traceback object");
                  input={...input,error:exceptions.throwError(args[0],args[1]??values.none,invocation)};
                }
              }
              return execution.resume(input);
            }
          },state.activity,{none:values.none,generatorExit:()=>exceptions.signal("GeneratorExit"),isGeneratorExit:error=>exceptions.matches(error,"GeneratorExit"),isStopAsyncIteration:error=>exceptions.matches(error,"StopAsyncIteration"),exhausted:()=>exceptions.signal("StopAsyncIteration")},name==="asend"?positional[0]:values.none,meter);
          return values.instance(sendType(),undefined,Object.freeze({kind:"async_generator_asend",generator:receiver,operation}));
        }
      };
      owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
    }
    for(const name of ["ag_running","ag_await"] as const) {
      meter.checkpoint(0,96);
      owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,accepts,get(receiver){
        if(receiver.kind!=="instance"||receiver.native?.kind!=="async_generator")throw Error("async generator requires native storage");
        return name==="ag_running"?values.boolean(receiver.native.activity.running):receiver.native.execution.yieldFrom;
      }}));
    }
    return;
  }
  for(const name of ["__iter__","__await__","__next__","send","throw","close"] as const) {
    meter.checkpoint(0,96);
    const descriptor={owner,name,accepts,
      invoke(receiver:RuntimeValue,positional:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext) {
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`async_generator_asend.${name}() takes no keyword arguments`);
        const count=name==="send"?1:0;
        if(name!=="throw"&&positional.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${positional.length}`:`async_generator_asend.${name}() takes ${count===0?"no arguments":"exactly one argument"} (${positional.length} given)`);
        if(name==="__iter__"||name==="__await__")return receiver;
        if(receiver.kind!=="instance"||receiver.native?.kind!=="async_generator_asend"||receiver.native.generator.native?.kind!=="async_generator")throw Error("async generator send requires native storage");
        const {operation,generator}=receiver.native;
        if(name==="throw"&&invocation===undefined)throw Error("async generator throw requires invocation policy");
        const result=operation.resume(name==="throw"?{kind:"throw",error:new RuntimeGeneratorThrowRequest(positional,invocation!,meter)}:name==="close"?{kind:"close"}:{kind:"send",value:name==="send"?positional[0]:values.none});
        if(result.done&&name!=="close") {
          if(generator.native?.kind!=="async_generator")throw Error("async generator send lost its owner");
          throw generator.native.exceptions.completion(result.value);
        }
        return result.value;
      }
    };
    owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
  }
}
