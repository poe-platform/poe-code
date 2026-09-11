import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {suggestName} from "./name-suggestion.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {encodeUtf8} from "./utf8-encode.js";
import type {RuntimeTextEncoder} from "./runtime-utf8-encoding.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

const parameters=["encoding","errors"] as const;

/** Bind native encoding without coercing string subtypes or discovering host
 * codecs. Codec extensions receive immutable payload storage and live context. */
export function createRuntimeStringEncodeMethod(receiver:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,codec:RuntimeTextEncoder):BuiltinFunctionValue {
  meter.checkpoint(1,96);
  const payload=runtimeStringPayload(receiver);
  if(payload===undefined)throw Error("encoding requires native string storage");
  return values.builtinFunction({name:"encode",invoke(positional,keywords,meter,invocation){
    let fatal=false;
    try{
      meter.checkpoint(1,128);
      const count=positional.length+keywords.items.size;
      if(count>2)throw new PythonRuntimeError("TypeError",`encode() takes at most 2 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
      const args=[...positional];let unexpected:string|undefined,duplicate=-1;
      for(const [key,value] of keywords.items.snapshot()){
        if(key.kind!=="str")throw new PythonRuntimeError("TypeError","keywords must be strings");
        let name="";for(const point of key.value){meter.checkpoint(1,64);name+=String.fromCodePoint(point);}
        const index=(parameters as readonly string[]).indexOf(name);
        if(index<0){unexpected??=name;continue;}
        if(index<positional.length){if(duplicate<0||index<duplicate)duplicate=index;continue;}
        args[index]=value;
      }
      if(duplicate>=0)throw new PythonRuntimeError("TypeError",`argument for encode() given by name ('${parameters[duplicate]}') and position (${duplicate+1})`);
      if(unexpected!==undefined){
        const suggestion=suggestName(unexpected,parameters,meter);
        throw new PythonRuntimeError("TypeError",`encode() got an unexpected keyword argument '${unexpected}'${suggestion===undefined?"":`. Did you mean '${suggestion}'?`}`);
      }
      const names:string[]=[];
      for(let index=0;index<2;index++){
        const value=args[index];if(value===undefined){names.push(index===0?"utf-8":"strict");continue;}
        const text=runtimeStringPayload(value);
        if(text===undefined)throw new PythonRuntimeError("TypeError",`encode() argument '${parameters[index]}' must be str, not ${diagnosticTypeName(value.kind==="none"?"None":value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind,meter)}`);
        let name="";
        for(const point of text.value){
          meter.checkpoint(1,64);
          if(point>=0xd800&&point<=0xdfff){
            try{encodeUtf8(text.value,"strict",meter);}catch(error){if(error instanceof PythonEncodeError&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:value});throw error;}
          }
          name+=String.fromCodePoint(point);
        }
        if(name.includes("\0"))throw new PythonRuntimeError("ValueError","embedded null character");
        names.push(name);
      }
      let result:RuntimeValue;
      try{result=codec(payload.value,names[0],names[1],meter,invocation);}
      catch(error){if(error instanceof PythonEncodeError&&error.object===payload.value&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:receiver});throw error;}
      meter.checkpoint();
      if(result.kind!=="bytes")throw Error("string encoder must return a bytes value");
      return result;
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}
