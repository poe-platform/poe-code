import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext,RuntimeValue,RuntimeValues } from "./runtime-values.js";
import type { ResumableStatementContext } from "./statement-execution.js";
import {acquireRuntimeAsyncIterator} from "./runtime-async-iterator-acquisition.js";

/** Native async-for protocol. Only next-call/await exhaustion ends the loop;
 * target assignment and body errors remain outside this adapter. No implicit
 * aclose or host Promise/async-iterator capability is introduced. */
export function createRuntimeAsyncIterator(source:RuntimeValue,invocation:BuiltinInvocationContext,awaitNext:(value:RuntimeValue)=>Generator<RuntimeValue,RuntimeValue,RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter):ReturnType<NonNullable<ResumableStatementContext<RuntimeValue>["asyncIterate"]>> {
  meter.checkpoint(1,256);
  const iterator=acquireRuntimeAsyncIterator(source,invocation,meter,"async for");
  return {next:()=>advanceRuntimeAsyncIterator(iterator,invocation,awaitNext,values,meter)};
}

/** Pull one item from a prepared async iterator without calling __aiter__. */
export function* advanceRuntimeAsyncIterator(iterator:RuntimeValue,invocation:BuiltinInvocationContext,awaitNext:(value:RuntimeValue)=>Generator<RuntimeValue,RuntimeValue,RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter):Generator<RuntimeValue,IteratorResult<RuntimeValue>,RuntimeValue>{
    meter.checkpoint(1,64);
    try {
      const next=invocation.lookupSpecial!(iterator,"__anext__");meter.checkpoint();
      if(next===undefined)throw new PythonRuntimeError("TypeError",`'async for' requires an iterator with __anext__ method, got ${invocation.typeName!(iterator)}`);
      const awaitable=invocation.call(next,[]);meter.checkpoint();
      const value=yield* awaitNext(awaitable);meter.checkpoint(0,32);
      return {done:false,value};
    } catch(error) {
      if(error instanceof ExecutionLimitError)throw error;
      if(!invocation.isException!(error,"StopAsyncIteration"))throw error;
      meter.checkpoint(0,32);return {done:true,value:values.none};
    }
}
