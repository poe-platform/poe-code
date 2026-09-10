import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue,RuntimeValues,TypeValue } from "./runtime-values.js";
import { throwRuntimeGenerator } from "./runtime-generator-throw-request.js";

/** Exact generator, coroutine and await-wrapper slots share descriptor dispatch.
 * Frame/code metadata, traceback attachment and finalization are separate work. */
export function installRuntimeGeneratorDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,wrapperType?:()=>TypeValue):void {
  meter.checkpoint(0,256);
  const kind=owner.value.name;
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind===kind;
  const stateOf=(value:RuntimeValue)=>{
    const native=value.kind==="instance"?value.native:undefined;
    const state=native?.kind==="coroutine_wrapper"?native.coroutine.native:native;
    if(state?.kind!=="generator"&&state?.kind!=="coroutine")throw Error("suspension descriptor requires native storage");
    return state;
  };
  const methods=kind==="coroutine"?["__await__","send","close"] as const:["__iter__","__next__","send","close"] as const;
  for(const name of methods) {
    meter.checkpoint(0,96);
    const descriptor={owner,name,accepts,
      invoke(receiver:RuntimeValue,positional:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`${kind}.${name}() takes no keyword arguments`);
        const count=name==="send"?1:0;
        if(positional.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${positional.length}`:`${kind}.${name}() takes ${count===0?"no arguments":"exactly one argument"} (${positional.length} given)`);
        if(name==="__iter__")return receiver;
        if(name==="__await__") {
          if(receiver.kind!=="instance"||wrapperType===undefined)throw Error("coroutine await requires wrapper type");
          meter.checkpoint(0,32);
          return values.instance(wrapperType(),undefined,Object.freeze({kind:"coroutine_wrapper",coroutine:receiver}));
        }
        const state=stateOf(receiver);
        const result=state.execution.resume(name==="close"?{kind:"close"}:{kind:"send",value:name==="send"?positional[0]:values.none});
        if(result.done&&name!=="close")throw state.exceptions.completion(result.value);
        return result.value;
      }
    };
    owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
  }
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("throw"),values.methodDescriptor({owner,name:"throw",accepts,
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${kind}.throw() takes no keyword arguments`);
      if(positional.length<1)throw new PythonRuntimeError("TypeError","throw expected at least 1 argument, got 0");
      if(positional.length>3)throw new PythonRuntimeError("TypeError",`throw expected at most 3 arguments, got ${positional.length}`);
      if(positional.length>1)invocation?.warn?.("DeprecationWarning","the (type, exc, tb) signature of throw() is deprecated, use the single-arg signature instead.");
      meter.checkpoint();
      if(invocation===undefined)throw Error("generator throw requires an invocation policy");
      return throwRuntimeGenerator(stateOf(receiver),positional,invocation,values,meter);
    }
  }));
  const properties=kind==="coroutine_wrapper"?[]:kind==="coroutine"?["cr_running","cr_suspended","cr_await"] as const:["gi_running","gi_suspended","gi_yieldfrom"] as const;
  for(const name of properties) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,accepts,
      get(receiver,meter) {
        meter.checkpoint();
        const state=stateOf(receiver);
        if(name==="gi_yieldfrom"||name==="cr_await")return state.execution.yieldFrom;
        return values.boolean(state.execution.phase===(name==="gi_running"||name==="cr_running"?"running":"suspended"));
      }
    }));
  }
}
