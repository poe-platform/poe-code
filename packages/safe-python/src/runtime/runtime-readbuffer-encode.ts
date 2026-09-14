import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {ImmutableBytes} from "./immutable-bytes.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {encodeUtf8} from "./utf8-encode.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** _codecs' raw-buffer operation accepts text via strict UTF-8 before checking
 * errors. Other inputs require a contiguous export, held until the result has
 * been copied. The errors name is validated but never looked up or applied. */
export function createRuntimeReadbufferEncode(values:RuntimeValues,meter:ExecutionMeter):BuiltinFunctionValue {
  meter.checkpoint(1,128);
  return values.builtinFunction({name:"readbuffer_encode",module:"_codecs",keywordValidation:"callee",textSignature:"($module, data, errors=None, /)",invoke(args,keywords,meter,context){
    let fatal=false,lease:RuntimeBufferLease|undefined;
    try{
      meter.checkpoint(1,128);
      if(keywords.items.size!==0){
        meter.checkpoint(0,288);
        throw new PythonRuntimeError("TypeError","_codecs.readbuffer_encode() takes no keyword arguments");
      }
      if(args.length<1||args.length>2){
        meter.checkpoint(0,352);
        throw new PythonRuntimeError("TypeError",`readbuffer_encode expected at ${args.length<1?"least 1 argument":"most 2 arguments"}, got ${args.length}`);
      }
      const typeName=(value:RuntimeValue,maxBytes=50)=>diagnosticTypeName(context?.typeName?.(value)??(value.kind==="none"?"NoneType":value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind),meter,maxBytes);
      const source=args[0],text=runtimeStringPayload(source),native=source.kind==="instance"?source.native:source;
      let encoded:Uint8Array|undefined,bytes:ImmutableBytes|undefined;
      if(text!==undefined){
        try{encoded=context?.codecs===undefined?encodeUtf8(text.value,"strict",meter):context.codecs.unicodeUtf8(source,context).toUint8Array(meter);}
        catch(error){if(error instanceof PythonEncodeError&&context?.prepareException!==undefined)throw context.prepareException(error,{unicodeObject:source});throw error;}
      }else if(native?.kind==="bytes"&&(source.kind==="bytes"||context?.buffers===undefined))bytes=native.value;
      else{
        lease=context?.buffers?.acquireSimple(source);
        meter.checkpoint();
        if(lease===undefined){
          const type=typeName(source,100);
          meter.checkpoint(0,256+2*type.length);
          throw new PythonRuntimeError("TypeError",`a bytes-like object is required, not '${type}'`);
        }
      }
      const errors=args[1];
      if(errors!==undefined&&errors.kind!=="none"){
        const name=runtimeStringPayload(errors);
        if(name===undefined){
          const type=typeName(errors);
          // Type resolution can consume the remaining allowance. Admit the
          // diagnostic after that service, while the export is still pinned.
          meter.checkpoint(0,320+2*type.length);
          throw new PythonRuntimeError("TypeError",`readbuffer_encode() argument 2 must be str or None, not ${type}`);
        }
        if(context?.codecs!==undefined)context.codecs.unicodeErrorPolicy(errors,context);
        else{
          try{encodeUtf8(name.value,"strict",meter);}
          catch(error){if(error instanceof PythonEncodeError&&context?.prepareException!==undefined)throw context.prepareException(error,{unicodeObject:errors});throw error;}
          for(const point of name.value){meter.checkpoint();if(point===0){meter.checkpoint(0,192);throw new PythonRuntimeError("ValueError","embedded null character");}}
        }
      }
      if(lease!==undefined)bytes=lease.copy();
      meter.checkpoint();
      const result=values.bytes(encoded??bytes!);
      return values.tuple([result,values.integer(result.value.length)]);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{lease?.release();if(!fatal)meter.checkpoint();}
  }});
}
