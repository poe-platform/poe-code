import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {CodePointString} from "./code-point-string.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {MultibyteDecodeRecovery,MultibyteEncodeRecovery} from "./gb2312-codec.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeIntegerPayload} from "./runtime-integer-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import type {BuiltinInvocationContext,InstanceValue,RuntimeValue} from "./runtime-values.js";

/** One native multibyte operation's cached exception. Unlike UTF recovery,
 * custom policies resolve the live named handler and accept only native integers.
 * Native strict/ignore/replace policies bypass overridden registry entries;
 * ignore/replace do not create or refresh the operation's cached exception.
 * Kernels retain their original input and validate positions after writing the
 * replacement, including the signed-size overflow rule. The supplied strict
 * encoder retains the codec's state while this adapter retains guest identity.
 * Incremental callers supply their current errors name on every fault. */
export class RuntimeMultibyteRecovery {
  #exception:InstanceValue|undefined;

  constructor(readonly registry:RuntimeCodecRegistry,readonly source:RuntimeValue,readonly context:BuiltinInvocationContext) {
    // The operation retains its source, invocation context and exception cache
    // even before the first fault. Admit that storage before it can escape,
    // without eagerly resolving the live error policy or invoking guest code.
    registry.meter.checkpoint(1,80);
  }

  recover(error:PythonDecodeError,errors:string):ReturnType<MultibyteDecodeRecovery>;
  recover(error:PythonEncodeError,errors:string,encodeReplacement:(text:CodePointString)=>Uint8Array):ReturnType<MultibyteEncodeRecovery>;
  recover(error:PythonDecodeError|PythonEncodeError,errors:string,encodeReplacement?:(text:CodePointString)=>Uint8Array):ReturnType<MultibyteEncodeRecovery> {
    const {registry,context}=this,{values,meter}=registry;
    let fatal=false;
    try {
      meter.checkpoint();
      const decode=error instanceof PythonDecodeError;
      if(errors==="ignore"){
        // Every fault returns a fresh recovery record. Encoding also owns an
        // empty byte buffer; zero payload length does not make it allocation-free.
        meter.checkpoint(0,48+(decode?0:64));
        return {replacement:decode?CodePointString.fromString("",meter):new Uint8Array(),position:BigInt(error.end)};
      }
      if(errors==="replace"){
        const replacement=CodePointString.fromString(decode?"\ufffd":"?",meter);
        if(decode){meter.checkpoint(0,48);return {replacement,position:BigInt(error.end)};}
        if(encodeReplacement===undefined)throw new Error("multibyte encoding recovery requires a strict replacement encoder");
        let output:Uint8Array;
        try{output=encodeReplacement(replacement);}
        catch(failure){
          if(!(failure instanceof PythonEncodeError))throw failure;
          // The native replace policy falls back to a literal question mark
          // if the codec cannot encode its replacement character.
          meter.checkpoint(1,1);output=Uint8Array.of(63);
        }
        meter.checkpoint(0,48);
        return {replacement:output,position:BigInt(error.end)};
      }
      if(this.#exception===undefined){
        const prepared=context.prepareException?.(error,{unraised:true,...(decode?{}:{unicodeObject:this.source})});
        // Preparation is an explicit service boundary. Check termination before
        // retaining its result or entering strict exception chaining.
        meter.checkpoint();
        if(!(prepared instanceof RuntimeRaisedException))throw new Error("multibyte recovery requires interpreter exception preparation");
        this.#exception=prepared.value;
      }else{
        const state=runtimeExceptionPayload(this.#exception)!;
        state.assignMember("start",values.integer(error.start),meter);
        state.assignMember("end",values.integer(error.end),meter);
        state.assignMember("reason",values.string(error.reason),meter);
      }
      if(errors==="strict"){
        // PyCodec_StrictErrors raises the cached instance anew. Its original
        // construction is unraised; attach the active guest context here and
        // break cycles without replacing its explicit cause or identity.
        if(context.chainException===undefined)throw new Error("multibyte recovery requires interpreter exception chaining");
        throw context.chainException(this.#exception);
      }
      const result=context.call(registry.lookupError(errors),[this.#exception]);
      meter.checkpoint();
      const tuple=runtimeTuplePayload(result),replacement=tuple?.items[0];
      const native=replacement?.kind==="instance"?replacement.native:replacement;
      const text=replacement===undefined?undefined:runtimeStringPayload(replacement);
      const position=tuple?.items.length===2?runtimeIntegerPayload(tuple.items[1]):undefined;
      if(tuple?.items.length!==2||position===undefined||(text===undefined&&(decode||native?.kind!=="bytes"))){
        throw new PythonRuntimeError("TypeError",`${decode?"decoding":"encoding"} error handler must return (str, int) tuple`);
      }
      let output=text===undefined&&native?.kind==="bytes"?native.value.toUint8Array(meter):text!.value;
      if(!decode&&text!==undefined){
        if(encodeReplacement===undefined)throw new Error("multibyte encoding recovery requires a strict replacement encoder");
        try{output=encodeReplacement(text.value);}
        catch(failure){
          if(failure instanceof PythonEncodeError){
            // A replacement encoder is an explicit service boundary. Its
            // failure must not reenter exception preparation after cancellation.
            meter.checkpoint();
            const prepared=context.prepareException?.(failure,{unicodeObject:replacement!});
            if(!(prepared instanceof RuntimeRaisedException))throw new Error("multibyte replacement requires interpreter exception preparation");
            throw prepared;
          }
          throw failure;
        }
        meter.checkpoint();
      }
      // Admit the returned record after validation and replacement encoding.
      // Guest callbacks may consume the remaining allocation budget themselves.
      meter.checkpoint(0,48);
      return {
        replacement:output,
        position:position.kind==="bool"?(position.value?1n:0n):position.value
      };
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }
}
