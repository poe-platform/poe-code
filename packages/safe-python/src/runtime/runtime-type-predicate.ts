import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeRealClassInstance,runtimeRealClassSubclass} from "./runtime-real-type-check.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import {runtimeTruth} from "./runtime-truth.js";
import type {BuiltinInvocationContext,RuntimeValue,TypeValue} from "./runtime-values.js";

/** Ordered tuple alternatives are lazy: invalid later members are never checked
 * after success. Virtual checks precede argument-class validation, but exact
 * actual-type identity shortcuts only isinstance, not custom issubclass checks. */
export function runtimeTypePredicate(name:"isinstance"|"issubclass",subject:RuntimeValue,classInfo:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  meter.checkpoint(1,112);const work:Array<{items:readonly RuntimeValue[];index:number}>=[{items:[classInfo],index:0}];
  while(work.length){
    meter.checkpoint();const frame=work[work.length-1];
    if(frame.index===frame.items.length){work.pop();continue;}
    const candidate=frame.items[frame.index++];
    if(candidate.kind==="type"){
      if(name==="isinstance"){
        if(!invocation?.actualType)throw Error("instance checks require an actual type policy");
        let actual:TypeValue;try{actual=invocation.actualType(subject);}finally{meter.checkpoint();}
        if(actual===candidate)return true;
      }
      if(!invocation?.objectType)throw Error("type predicates require canonical object metadata");
      if(candidate.metaclass===invocation.objectType.metaclass){
        if(name==="isinstance"?runtimeRealClassInstance(subject,candidate,meter,invocation):runtimeRealClassSubclass(subject,candidate,meter,invocation))return true;
        continue;
      }
    }
    const tuple=runtimeTuplePayload(candidate);
    if(tuple!==undefined){
      meter.checkpoint(0,48);work.push({items:tuple.items,index:0});
      continue;
    }
    if(!invocation?.lookupSpecial)throw Error("type predicates require special-method lookup");
    let checker:RuntimeValue|undefined;
    try{checker=invocation.lookupSpecial(candidate,name==="isinstance"?"__instancecheck__":"__subclasscheck__");}finally{meter.checkpoint();}
    if(checker!==undefined){
      let result:RuntimeValue;meter.checkpoint(0,40);
      try{result=invocation.call(checker,[subject]);}finally{meter.checkpoint();}
      let accepted:boolean;
      try{accepted=invocation.truth?invocation.truth(result):runtimeTruth(result,meter,invocation);}finally{meter.checkpoint();}
      if(accepted)return true;
    }else if(name==="isinstance"?runtimeRealClassInstance(subject,candidate,meter,invocation):runtimeRealClassSubclass(subject,candidate,meter,invocation))return true;
  }
  return false;
}
