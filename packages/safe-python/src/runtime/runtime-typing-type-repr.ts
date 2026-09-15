import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {representationObject} from "./representation-protocol.js";
import type {BuiltinInvocationContext,RuntimeValue,TypeValue} from "./runtime-values.js";

/** Runtime typing display uses ordinary metadata lookup, unlike type.__repr__.
 * AttributeError permits fallback; descriptor errors and str/repr faults escape. */
export function runtimeTypingTypeRepr(value:RuntimeValue,noneType:TypeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):string {
  if(value===noneType)return "None";
  if(!invocation?.attribute||!invocation.formatting)throw Error("typing representation requires attributes and formatting");
  const formatting=invocation.formatting;meter.checkpoint(0,128);
  const text=(value:RuntimeValue):string=>{
    let result="";for(const point of formatting.string(value)!){meter.checkpoint(1,point>0xffff?4:2);result+=String.fromCodePoint(point);}return result;
  };
  const optional=(name:string):RuntimeValue|undefined=>{
    try{return invocation.attribute!(value,name);}
    catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return undefined;throw error;}
    finally{meter.checkpoint();}
  };
  if(optional("__origin__")===undefined||optional("__args__")===undefined){
    const qualified=optional("__qualname__");
    if(qualified!==undefined){
      const module=optional("__module__");
      if(module!==undefined&&module.kind!=="none"){
        if(formatting.string(module)!==undefined&&text(module)==="builtins")return text(representationObject(qualified,"str",formatting,meter));
        const prefix=text(representationObject(module,"str",formatting,meter)),name=text(representationObject(qualified,"str",formatting,meter));
        meter.checkpoint(0,2*(prefix.length+name.length+1));return prefix+"."+name;
      }
    }
  }
  return text(representationObject(value,"repr",formatting,meter));
}
