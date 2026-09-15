import {bindRuntimeCodecArguments} from "./runtime-codec-arguments.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {requireRuntimeTextCodecResult} from "./runtime-text-codec-result.js";
import type {RuntimeTextEncoder} from "./runtime-utf8-encoding.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Bind native encoding without coercing string subtypes or discovering host
 * codecs. Codec extensions receive the original guest receiver and live context. */
export function createRuntimeStringEncodeMethod(receiver:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,codec:RuntimeTextEncoder):BuiltinFunctionValue {
  meter.checkpoint(1,96);
  const payload=runtimeStringPayload(receiver);
  if(payload===undefined)throw Error("encoding requires native string storage");
  return values.builtinFunction({name:"encode",invoke(positional,keywords,meter,invocation){
    let fatal=false;
    try{
      meter.checkpoint(1,128);
      const names=bindRuntimeCodecArguments("encode",positional,keywords,values,meter,invocation);
      let result:RuntimeValue;
      try{result=codec(receiver,names[0],names[1],meter,invocation);}
      catch(error){if(error instanceof PythonEncodeError&&error.object===payload.value&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:receiver});throw error;}
      meter.checkpoint();
      requireRuntimeTextCodecResult(result,"encode",names[0],meter,invocation);
      return result;
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}
