import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {suggestName} from "./name-suggestion.js";
import {representationObject,type RepresentationContext} from "./representation-protocol.js";
import {createRuntimeRepresentationContext} from "./runtime-representation.js";
import type {BuiltinInvocationContext,DictionaryValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

export interface RuntimeStringConstructionContext {
  /** Exact str(...) has a positional fast path absent from str.__new__. */
  readonly argumentMode?:"call"|"new";
  readonly invocation?:BuiltinInvocationContext;
  readonly representation?:RepresentationContext<RuntimeValue>;
  /** Codec lookup, buffer admission/acquisition/release and error handlers belong
   * to the execution. No host codec or filesystem capability is discovered. */
  decode?(source:RuntimeValue,encoding:string,errors:string,meter:ExecutionMeter,invocation:BuiltinInvocationContext|undefined):RuntimeValue;
}
const parameters=["object","encoding","errors"] as const;

/** str argument binding and conversion; canonical type/subclass allocation is
 * separate. Representation may preserve a returned string-subclass identity. */
export function constructRuntimeString(positional:readonly RuntimeValue[],keywords:DictionaryValue,values:RuntimeValues,meter:ExecutionMeter,context:RuntimeStringConstructionContext={}):RuntimeValue {
  let fatal=false;
  try {
    meter.checkpoint(1,192);
    const count=positional.length+keywords.items.size;
    if(context.argumentMode!=="new"&&keywords.items.size===0&&positional.length>3)throw new PythonRuntimeError("TypeError",`str expected at most 3 arguments, got ${positional.length}`);
    if(count>3)throw new PythonRuntimeError("TypeError",`str() takes at most 3 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
    const args=[...positional];let unexpected:string|undefined,duplicate=-1;
    for(const [key,value] of keywords.items.snapshot()){
      if(key.kind!=="str")throw new PythonRuntimeError("TypeError","keywords must be strings");
      const name=stringText(key,meter),index=(parameters as readonly string[]).indexOf(name);
      if(index<0){unexpected??=name;continue;}
      if(index<positional.length){if(duplicate<0||index<duplicate)duplicate=index;continue;}
      args[index]=value;
    }
    if(duplicate>=0)throw new PythonRuntimeError("TypeError",`argument for str() given by name ('${parameters[duplicate]}') and position (${duplicate+1})`);
    if(unexpected!==undefined){
      const suggestion=suggestName(unexpected,parameters,meter);meter.checkpoint(0,192+2*unexpected.length);
      throw new PythonRuntimeError("TypeError",`str() got an unexpected keyword argument '${unexpected}'${suggestion===undefined?"":`. Did you mean '${suggestion}'?`}`);
    }
    const invocation=context.invocation;
    const representation=context.representation??invocation?.formatting??createRuntimeRepresentationContext(values,meter,{defaultRepr(){throw Error("string construction requires an object representation policy");}});
    const names:string[]=[];
    for(let index=1;index<3;index++){
      const value=args[index];
      if(value===undefined){names.push(index===1?"utf-8":"strict");continue;}
      const storage=representation.string(value);meter.checkpoint();
      if(storage===undefined){
        const name=value.kind==="none"?(context.argumentMode!=="new"&&keywords.items.size===0?"NoneType":"None"):invocation?.typeName?.(value)??(value.kind==="not-implemented"?"NotImplementedType":value.kind);
        throw new PythonRuntimeError("TypeError",`str() argument '${parameters[index]}' must be str, not ${diagnosticTypeName(name,meter)}`);
      }
      let name="";
      for(let offset=0;offset<storage.length;offset++){
        const point=storage.codePointAt(BigInt(offset),meter);
        if(point>=0xd800&&point<=0xdfff){
          let end=offset+1;
          while(end<storage.length){const next=storage.codePointAt(BigInt(end),meter);if(next<0xd800||next>0xdfff)break;end++;}
          meter.checkpoint(0,320);
          const error=new PythonEncodeError("utf-8",storage,offset,end,"surrogates not allowed");
          if(invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:value});
          throw error;
        }
        meter.checkpoint(1,64+(point>0xffff?4:2));name+=String.fromCodePoint(point);
      }
      if(name.includes("\0"))throw new PythonRuntimeError("ValueError","embedded null character");
      names.push(name);
    }
    const source=args[0];if(source===undefined)return values.string("");
    if(args[1]===undefined&&args[2]===undefined)return representationObject(source,"str",representation,meter);
    const text=representation.string(source);meter.checkpoint();
    if(text!==undefined)throw new PythonRuntimeError("TypeError","decoding str is not supported");
    if(context.decode===undefined)throw Error("string decoding requires an execution codec policy");
    const result=context.decode(source,names[0],names[1],meter,invocation);meter.checkpoint();
    const decoded=representation.string(result);meter.checkpoint();
    if(decoded===undefined)throw Error("string decoder must return a string value");
    return result;
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}

function stringText(value:Extract<RuntimeValue,{kind:"str"}>,meter:ExecutionMeter):string {
  let text="";for(const point of value.value){meter.checkpoint(1,64+(point>0xffff?4:2));text+=String.fromCodePoint(point);}return text;
}
