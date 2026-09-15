import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {acquireAwaitableIterator} from "./awaitable-iterator.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import type {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

export interface RuntimeAnextAwaitableState {
  readonly kind:"anext_awaitable";
  readonly wrapped:RuntimeValue;
  readonly defaultValue:RuntimeValue;
  readonly exceptions:RuntimeExceptionExecution;
}

/** The wrapped object owns reuse and suspension. Every operation reacquires its
 * await iterator. Only errors from advancing/proxying it receive the default;
 * await acquisition errors retain their original identity. */
export function installRuntimeAnextAwaitableDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="anext_awaitable";
  for(const name of ["__iter__","__await__","__next__","send","throw","close"] as const) {
    meter.checkpoint(0,96);
    const descriptor={owner,name,accepts,invoke(receiver:RuntimeValue,args:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext){
      meter.checkpoint();
      if(keywords.items.size)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`anext_awaitable.${name}() takes no keyword arguments`);
      const count=name==="send"?1:0;
      if(name!=="throw"&&args.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${args.length}`:`anext_awaitable.${name}() takes ${count===0?"no arguments":"exactly one argument"} (${args.length} given)`);
      if(name==="__iter__"||name==="__await__")return receiver;
      if(receiver.kind!=="instance"||receiver.native?.kind!=="anext_awaitable")throw Error("anext awaitable requires native storage");
      if(!invocation?.lookupSpecial||!invocation.iteration||!invocation.typeName||!invocation.attribute)throw Error("anext awaitable requires execution protocols");
      const state=receiver.native;
      meter.checkpoint(0,256);
      let iterator=acquireAwaitableIterator(state.wrapped,{
        nativeKind:value=>value.kind==="instance"&&value.native?.kind==="coroutine"?"coroutine":undefined,
        lookupAwait(value){const method=invocation.lookupSpecial!(value,"__await__");if(method===undefined)return undefined;meter.checkpoint(0,64);return ()=>invocation.call(method,[]);},
        hasNext:value=>invocation.iteration!.hasNext(value),typeName:value=>invocation.typeName!(value)
      },meter);
      if(iterator.kind==="instance"&&iterator.native?.kind==="coroutine") {
        const method=invocation.lookupSpecial(iterator,"__await__")!;
        iterator=invocation.call(method,[]);meter.checkpoint();
      }
      try {
        if(name==="__next__")return invocation.iteration.next(iterator);
        const method=invocation.attribute(iterator,name);meter.checkpoint();
        // CPython's proxy uses tuple argument expansion even for send(value).
        const forwarded=name==="send"?runtimeTuplePayload(args[0])?.items??args:args;
        return invocation.call(method,forwarded);
      }catch(error){
        meter.checkpoint();
        if(error instanceof ExecutionLimitError)throw error;
        if(state.exceptions.matches(error,"StopAsyncIteration"))throw state.exceptions.completion(state.defaultValue,true);
        throw error;
      }finally{meter.checkpoint();}
    }};
    owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
  }
}
