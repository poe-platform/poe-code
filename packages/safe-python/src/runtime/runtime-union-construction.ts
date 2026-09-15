import type {ExecutionMeter} from "./execution-budget.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeHashError} from "./runtime-hash-error.js";
import {runtimeUnionPayload} from "./runtime-union-state.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Unchecked union operator construction after eligibility checks. Preserve
 * insertion order separately from hashable/unhashable deduplication; only the
 * initial hash probe suppresses guest errors, never equality or termination. */
export function constructRuntimeUnion(left:RuntimeValue,right:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,
  keys:KeyOperations<RuntimeValue>,noneType:()=>TypeValue,publish:()=>TypeValue,invocation?:BuiltinInvocationContext):RuntimeValue {
  if((left.kind!=="type"&&left.kind!=="none"&&!runtimeUnionPayload(left))||(right.kind!=="type"&&right.kind!=="none"&&!runtimeUnionPayload(right)))return values.notImplemented;
  meter.checkpoint(1,160);const args:RuntimeValue[]=[],unhashable:RuntimeValue[]=[],hashable=new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter);
  try{
    for(const source of [left,right]){
      const members=runtimeUnionPayload(source)?.args.items??[source];meter.checkpoint(0,40);
      for(let arg of members){
        meter.checkpoint();if(arg.kind==="none")arg=noneType();
        let failed=false;
        try{keys.hash(arg);}catch(error){
          meter.checkpoint();if(!(error instanceof PythonRuntimeError)&&!invocation?.isException?.(error,"BaseException"))throw error;
          failed=true;
        }
        meter.checkpoint();
        if(failed){
          let duplicate=false;
          for(const prior of unhashable){meter.checkpoint();if(prior===arg||keys.equal(prior,arg)){duplicate=true;break;}}
          if(duplicate)continue;
          meter.checkpoint(0,8);unhashable.push(arg);
        }else{
          if(hashable.containsKey(arg))continue;
          hashable.set(arg,values.none);
        }
        meter.checkpoint(0,8);args.push(arg);
      }
    }
    if(args.length===1)return args[0];
    meter.checkpoint(0,64);
    const state=Object.freeze({kind:"union" as const,args:values.tuple(args),hashable:values.frozenSet(hashable),unhashable:unhashable.length?values.tuple(unhashable):undefined});
    return values.instance(publish(),undefined,state);
  }catch(error){throw error instanceof RuntimeHashError?error.original:error;}
  finally{meter.checkpoint();}
}
