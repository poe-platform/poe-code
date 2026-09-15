import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";

/** Class-like protocols accept actual tuple-subclass storage, not iteration. */
export function runtimeAbstractBases(value:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext){
  if(!invocation?.attribute)throw Error("abstract classes require an attribute policy");
  let result:RuntimeValue;
  try{result=invocation.attribute(value,"__bases__");}
  catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return undefined;throw error;}
  finally{meter.checkpoint();}
  return runtimeTuplePayload(result);
}

/** Validation belongs to the calling protocol. This traversal preserves repeated
 * reads and branch order, and does not recurse on the host stack. */
export function runtimeAbstractSubclass(derived:RuntimeValue,target:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  meter.checkpoint(0,112);const work:Array<{items:readonly RuntimeValue[];index:number}>=[{items:[derived],index:0}];
  while(work.length){
    meter.checkpoint();const frame=work[work.length-1];
    if(frame.index===frame.items.length){work.pop();continue;}
    let current=frame.items[frame.index++];
    for(;;){
      meter.checkpoint();if(current===target)return true;
      const found=runtimeAbstractBases(current,meter,invocation);if(found===undefined||found.items.length===0)break;
      if(found.items.length===1){current=found.items[0];continue;}
      meter.checkpoint(0,48);work.push({items:found.items,index:0});
      break;
    }
  }
  return false;
}
