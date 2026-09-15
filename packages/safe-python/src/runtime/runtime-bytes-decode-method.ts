import {bindRuntimeCodecArguments} from "./runtime-codec-arguments.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {createRuntimeStringDecoder,type RuntimeTextDecoder} from "./runtime-string-decoding.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Decode through the same execution-owned text policy as str construction.
 * Argument validation precedes the decoder's empty-buffer lookup shortcut. */
export function createRuntimeBytesDecodeMethod(receiver:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,codec:RuntimeTextDecoder):BuiltinFunctionValue {
  meter.checkpoint(1,96);
  const decode=createRuntimeStringDecoder(codec,values);
  return values.builtinFunction({name:"decode",invoke(positional,keywords,meter,invocation){
    let fatal=false;
    try {
      meter.checkpoint(1,128);
      const [encoding,errors]=bindRuntimeCodecArguments("decode",positional,keywords,values,meter,invocation);
      return decode(receiver,encoding,errors,meter,invocation);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}
