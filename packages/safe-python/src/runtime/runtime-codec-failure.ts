import type {ImmutableBytes} from "./immutable-bytes.js";
import {displayRuntimeEncodingName} from "./runtime-encoding-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {BuiltinInvocationContext} from "./runtime-values.js";

/** Registry dispatch annotates codec execution failures, but never lookup,
 * result-validation or fatal sandbox failures. Preserve the guest exception
 * and use BaseException's note protocol through the owning interpreter. */
export function throwRuntimeCodecFailure(error:unknown,operation:"encode"|"decode",encoding:string|ImmutableBytes,meter:ExecutionMeter,context:BuiltinInvocationContext|undefined):never {
  if(error instanceof ExecutionLimitError)throw error;
  try {
  meter.checkpoint();
  const guest=error instanceof PythonRuntimeError||context!==undefined&&runtimeExceptionMatches(error,"BaseException",context);
  // Classification is an explicit interpreter service. Observe cancellation
  // before entering another service to mutate the exception's notes.
  meter.checkpoint();
  if(guest){
    const note=()=>{
      meter.checkpoint(encoding.length+1,128+encoding.length*2);
      return `${operation==="encode"?"encoding":"decoding"} with '${displayRuntimeEncodingName(encoding,meter)}' codec failed`;
    };
    if(context?.addExceptionNote)throw context.addExceptionNote(error,note);
    if(error instanceof PythonRuntimeError)error.addNote(note(),meter);
  }
  throw error;
  } catch(failure) {
    // Both classification and note mutation may return or throw after an
    // explicit service cancels. Preserve fatal identity; otherwise termination
    // must win before exposing a catchable error to the caller.
    if(!(failure instanceof ExecutionLimitError))meter.checkpoint();
    throw failure;
  }
}
