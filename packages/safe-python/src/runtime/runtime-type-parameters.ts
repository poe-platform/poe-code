import type {ExecutionMeter} from "./execution-budget.js";
import type {TupleConstant} from "./constant-values.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import {runtimeListPayload} from "./runtime-list-payload.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {collectIterator} from "./iterator-collection.js";

/** Discover parameters in encounter order, using identity rather than guest
 * equality. Tuple storage is borrowed; lists are snapshotted through iteration
 * before reading their elements' attributes, including list-subclass hooks. */
export function collectRuntimeTypeParameters(args:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:Pick<BuiltinInvocationContext,"attribute"|"isException"|"iteration">):TupleConstant<RuntimeValue> {
  meter.checkpoint(1,160);
  const result:RuntimeValue[]=[],seen=new Set<RuntimeValue>();
  const frames:{items:readonly RuntimeValue[];index:number}[]=[];
  const push=(source:RuntimeValue):void=>{
    meter.checkpoint(1,48);
    const tuple=runtimeTuplePayload(source);
    const items=tuple?.items??collectIterator(runtimeIterate(source,values,meter,invocation?.iteration),meter);
    frames.push({items,index:0});
  };
  const add=(value:RuntimeValue):void=>{
    meter.checkpoint();if(seen.has(value))return;
    meter.checkpoint(0,48);seen.add(value);result.push(value);
  };
  const optional=(value:RuntimeValue,name:string):RuntimeValue|undefined=>{
    if(!invocation?.attribute)throw Error("type parameters require ordinary attribute lookup");
    try{return invocation.attribute(value,name);}
    catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return undefined;throw error;}
    finally{meter.checkpoint();}
  };
  try{
    push(args);
    while(frames.length){
      meter.checkpoint();const frame=frames[frames.length-1];
      if(frame.index===frame.items.length){frames.pop();continue;}
      const value=frame.items[frame.index++];
      if(value.kind==="type")continue;
      if(optional(value,"__typing_subst__")!==undefined){add(value);continue;}
      const parameters=optional(value,"__parameters__");
      if(parameters===undefined){
        if(runtimeTuplePayload(value)||runtimeListPayload(value))push(value);
      }else{
        const tuple=runtimeTuplePayload(parameters);
        if(tuple)for(const parameter of tuple.items)add(parameter);
      }
    }
    return values.tuple(result);
  }finally{meter.checkpoint();}
}
