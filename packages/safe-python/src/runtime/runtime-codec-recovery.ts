import type {ImmutableBytes} from "./immutable-bytes.js";
import type {PythonDecodeError} from "./decode-error.js";
import type {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {BuiltinInvocationContext,InstanceValue,RuntimeValue} from "./runtime-values.js";
import type {WideDecodeRecovery,WideEncodeRecovery} from "./utf-wide.js";
import type {Utf8EncodeRecovery} from "./utf8-encode.js";

/** One encode/decode call's lazy callback and UnicodeError cache. A registry
 * mutation affects the next operation, not subsequent faults within this one.
 * Encoding retains guest source identity; decoding snapshots its input bytes.
 * This adapter reads native fields
 * after the registry has validated return types and __index__ side effects. */
export class RuntimeCodecRecovery {
  #handler:RuntimeValue|undefined;
  #exception:InstanceValue|undefined;

  constructor(readonly registry:RuntimeCodecRegistry,readonly errors:string|ImmutableBytes,readonly source:RuntimeValue,readonly context:BuiltinInvocationContext) {
    // Each operation owns its callback/exception cache even before a fault.
    // Admit that retained state without eagerly resolving the error handler.
    registry.meter.checkpoint(1,80);
  }

  decode(error:PythonDecodeError):ReturnType<WideDecodeRecovery> {
    const result=this.#recover(error,"decode",error.object.length);
    const object=result.object,bytes=object?.kind==="instance"?object.native:object;
    if(bytes?.kind!=="bytes")throw new Error("codec recovery requires native UnicodeDecodeError object storage");
    // Registry validation owns a separate record. Admit this kernel-facing
    // record as well, after callback services have consumed their allowance.
    this.registry.meter.checkpoint(0,48);
    return {replacement:runtimeStringPayload(result.replacement)!.value,position:result.position,input:bytes.value.toUint8Array(this.registry.meter)};
  }

  encode(error:PythonEncodeError):ReturnType<WideEncodeRecovery>&ReturnType<Utf8EncodeRecovery> {
    const result=this.#recover(error,"encode",error.object.length);
    const native=result.replacement.kind==="instance"?result.replacement.native:result.replacement;
    const failure=new RuntimeRaisedException(this.#exception!,this.registry.meter);
    // Each result retains a fresh record and rejection closure, even when the
    // handler reuses its replacement tuple and the exception is already cached.
    this.registry.meter.checkpoint(0,128);
    return {replacement:native?.kind==="bytes"?native.value.toUint8Array(this.registry.meter):runtimeStringPayload(result.replacement)!.value,position:result.position,failure,
      rejectReplacement:()=>{
        // Kernels reject unencodable text or invalid raw replacement bytes by
        // restoring the fault location/reason on the cached guest exception.
        // Handler mutations to object, encoding and args remain intact.
        const {values,meter}=this.registry,state=runtimeExceptionPayload(this.#exception!)!;
        state.assignMember("start",values.integer(error.start),meter);
        state.assignMember("end",values.integer(error.end),meter);
        state.assignMember("reason",values.string(error.reason),meter);
        // Setting this cached exception as the current error is a new raise:
        // use the active context and remove cycles created by the callback.
        if(this.context.chainException===undefined)throw new Error("codec replacement rejection requires interpreter exception chaining");
        try{throw this.context.chainException(this.#exception!);}
        catch(error){
          // Chaining can cross a service boundary. Observe cancellation on
          // return or failure before exposing the rejected replacement error.
          if(!(error instanceof ExecutionLimitError))meter.checkpoint();
          throw error;
        }
      }
    };
  }

  #recover(error:PythonEncodeError|PythonDecodeError,operation:"encode"|"decode",length:number):ReturnType<RuntimeCodecRegistry["handleError"]> {
    const {registry,context}=this,{values,meter}=registry;
    meter.checkpoint();
    this.#handler??=registry.lookupError(this.errors,context);
    if(this.#exception===undefined){
      let prepared:unknown;
      try{
        prepared=context.prepareException?.(error,{unraised:true,...(operation==="encode"?{unicodeObject:this.source}:{})});
      }catch(failure){
        // A preparation service can cancel and fail simultaneously. Ordinary
        // failures must not mask termination; preserve an existing fatal error.
        if(!(failure instanceof ExecutionLimitError))meter.checkpoint();
        throw failure;
      }
      meter.checkpoint();
      if(!(prepared instanceof RuntimeRaisedException))throw new Error("codec recovery requires interpreter exception preparation");
      this.#exception=prepared.value;
    }else{
      const state=runtimeExceptionPayload(this.#exception)!;
      state.assignMember("start",values.integer(error.start),meter);
      state.assignMember("end",values.integer(error.end),meter);
      state.assignMember("reason",values.string(error.reason),meter);
    }
    return registry.handleError(this.#handler,this.#exception,operation,length,context);
  }
}
