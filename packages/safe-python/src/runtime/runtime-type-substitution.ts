import type {TupleConstant} from "./constant-values.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {PythonRuntimeError} from "./error.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import {runtimeListPayload} from "./runtime-list-payload.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeTruth} from "./runtime-truth.js";
import {runtimeGetItem} from "./runtime-subscription.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {collectIterator} from "./iterator-collection.js";
import {representationObject} from "./representation-protocol.js";

/** Shared generic substitution kernel. Nested list/tuple arguments rerun input
 * unpacking and preparation, but an explicit stack avoids host recursion.
 * Native types bypass guest metadata; aliases use normal subscription slots. */
export function substituteRuntimeTypeParameters(owner:RuntimeValue,args:RuntimeValue,parameters:TupleConstant<RuntimeValue>,item:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):TupleConstant<RuntimeValue> {
  meter.checkpoint(1,224);
  const positions=new Map<RuntimeValue,number>();
  for(let index=0;index<parameters.items.length;index++){meter.checkpoint();if(!positions.has(parameters.items[index])){meter.checkpoint(0,40);positions.set(parameters.items[index],index);}}
  const optional=(value:RuntimeValue,name:string):RuntimeValue|undefined=>{
    if(!invocation?.attribute)throw Error("type substitution requires ordinary attributes");
    try{return invocation.attribute(value,name);}
    catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return undefined;throw error;}
    finally{meter.checkpoint();}
  };
  const repr=():string=>{
    if(!invocation?.formatting)throw Error("type substitution diagnostics require formatting");
    const rendered=representationObject(owner,"repr",invocation.formatting,meter);let text="";
    for(const point of invocation.formatting.string(rendered)!){meter.checkpoint(1,point>0xffff?4:2);text+=String.fromCodePoint(point);}return text;
  };
  const append=(target:RuntimeValue[],value:RuntimeValue):void=>{meter.checkpoint(1,8);target.push(value);};
  const prepare=(source:RuntimeValue):RuntimeValue=>{
    if(parameters.items.length===0)throw new PythonRuntimeError("TypeError",`${repr()} is not a generic class`);
    meter.checkpoint(0,32);const unpacked:RuntimeValue[]=[];
    for(const value of runtimeTuplePayload(source)?.items??[source]){
      meter.checkpoint();const nested=value.kind==="type"?undefined:optional(value,"__typing_unpacked_tuple_args__");
      const tuple=nested===undefined?undefined:runtimeTuplePayload(nested);
      if(tuple&&tuple.items[tuple.items.length-1]?.kind!=="ellipsis")for(const entry of tuple.items)append(unpacked,entry);
      else append(unpacked,value);
    }
    let prepared:RuntimeValue=values.tuple(unpacked);
    for(const parameter of parameters.items){
      meter.checkpoint();const hook=optional(parameter,"__typing_prepare_subst__");
      if(hook!==undefined&&hook.kind!=="none"){
        meter.checkpoint(0,24);prepared=invocation!.call(hook,[owner,runtimeTuplePayload(prepared)?prepared:values.tuple([prepared])]);meter.checkpoint();
      }
    }
    const count=runtimeTuplePayload(prepared)?.items.length??1;
    if(count!==parameters.items.length)throw new PythonRuntimeError("TypeError",`Too ${count>parameters.items.length?"many":"few"} arguments for ${repr()}; actual ${count}, expected ${parameters.items.length}`);
    return prepared;
  };
  type Frame={args:readonly RuntimeValue[];index:number;item:RuntimeValue;substitutions:readonly RuntimeValue[];result:RuntimeValue[];list:boolean};
  const frames:Frame[]=[];
  const push=(source:RuntimeValue,replacements:RuntimeValue):void=>{
    meter.checkpoint(1,112);const prepared=prepare(replacements);
    const tuple=runtimeTuplePayload(source),entries=tuple?.items??collectIterator(runtimeIterate(source,values,meter,invocation?.iteration),meter);
    frames.push({args:entries,index:0,item:prepared,substitutions:runtimeTuplePayload(prepared)?.items??[prepared],result:[],list:tuple===undefined});
  };
  try{
    push(args,item);
    while(frames.length){
      meter.checkpoint();const frame=frames[frames.length-1];
      if(frame.index===frame.args.length){
        frames.pop();const result=values.tuple(frame.result);
        if(frames.length===0)return result;
        append(frames[frames.length-1].result,frame.list?values.list(result.items):result);continue;
      }
      const arg=frame.args[frame.index++];
      if(arg.kind==="type"){append(frame.result,arg);continue;}
      if(runtimeTuplePayload(arg)||runtimeListPayload(arg)){push(arg,frame.item);continue;}
      const unpacked=optional(arg,"__typing_is_unpacked_typevartuple__");
      const unpack=unpacked===undefined?false:invocation?.truth?invocation.truth(unpacked):runtimeTruth(unpacked,meter,invocation);meter.checkpoint();
      const hook=optional(arg,"__typing_subst__");let result:RuntimeValue=arg;
      if(hook!==undefined){
        const position=positions.get(arg);if(position===undefined)throw Error("substitution parameter missing from discovered parameters");
        meter.checkpoint(0,16);result=invocation!.call(hook,[frame.substitutions[position]]);meter.checkpoint();
      }else{
        const nested=optional(arg,"__parameters__"),subparams=nested===undefined?undefined:runtimeTuplePayload(nested);
        if(subparams?.items.length){
          meter.checkpoint(0,32);const replacements:RuntimeValue[]=[];
          for(const parameter of subparams.items){
            meter.checkpoint();const position=positions.get(parameter);
            if(position===undefined){append(replacements,parameter);continue;}
            const replacement=frame.substitutions[position],tuple=runtimeTuplePayload(replacement);
            if(tuple){
              if(!invocation?.hasSpecial)throw Error("variadic substitution requires native slot presence");
              const iterable=invocation.hasSpecial(parameter,"__iter__");meter.checkpoint();
              if(iterable){for(const entry of tuple.items)append(replacements,entry);continue;}
            }
            append(replacements,replacement);
          }
          result=runtimeGetItem(arg,values.tuple(replacements),values,meter,invocation,invocation?.integerIndex);meter.checkpoint();
        }
      }
      if(unpack){
        const tuple=runtimeTuplePayload(result);
        if(!tuple){
          const name=invocation?.typeName?.(arg)??arg.kind,returned=invocation?.typeName?.(result)??result.kind;
          meter.checkpoint(0,160+2*(name.length+returned.length));
          throw new PythonRuntimeError("TypeError",`expected __typing_subst__ of ${name} objects to return a tuple, not ${returned}`);
        }
        for(const value of tuple.items)append(frame.result,value);
      }else append(frame.result,result);
    }
    throw Error("missing substitution result");
  }finally{meter.checkpoint();}
}
