import type {ImmutableBytes} from "./immutable-bytes.js";
import {decodeByteEscape} from "./byte-escape.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {encodeUtf8} from "./utf8-encode.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Native _codecs byte transforms. Decoding accepts a contiguous buffer or UTF-8
 * text; encoding requires bytes storage. Warnings and exports use explicit
 * interpreter services. See CPYTHON-LICENSE.txt for the reference contract. */
export function createRuntimeByteEscape(operation:"encode"|"decode",values:RuntimeValues,meter:ExecutionMeter):BuiltinFunctionValue {
  const name=`escape_${operation}`,encode=operation==="encode";
  meter.checkpoint(1,128);
  return values.builtinFunction({name,module:"_codecs",keywordValidation:"callee",textSignature:"($module, data, errors=None, /)",invoke(args,keywords,meter,context){
    let fatal=false,lease:RuntimeBufferLease|undefined;
    try{
      meter.checkpoint(1,128);
      if(keywords.items.size!==0){
        meter.checkpoint(0,256+2*name.length);
        throw new PythonRuntimeError("TypeError",`_codecs.${name}() takes no keyword arguments`);
      }
      if(args.length<1||args.length>2){
        meter.checkpoint(0,320+2*name.length);
        throw new PythonRuntimeError("TypeError",`${name} expected at ${args.length<1?"least 1 argument":"most 2 arguments"}, got ${args.length}`);
      }
      const typeName=(value:RuntimeValue,none="NoneType",maxBytes=50)=>diagnosticTypeName(value.kind==="none"?none:context?.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind),meter,maxBytes);
      const utf8=(value:RuntimeValue)=>{
        try{return context?.codecs===undefined?encodeUtf8(runtimeStringPayload(value)!.value,"strict",meter):context.codecs.unicodeUtf8(value,context).toUint8Array(meter);}
        catch(error){if(error instanceof PythonEncodeError&&context?.prepareException!==undefined)throw context.prepareException(error,{unicodeObject:value});throw error;}
      };
      const source=args[0],native=source.kind==="instance"?source.native:source;
      let input:Uint8Array|undefined;
      if(native?.kind!=="bytes"||!encode&&source.kind!=="bytes"&&context?.buffers!==undefined){
        if(encode){
          const type=typeName(source,"None");
          meter.checkpoint(0,256+2*(name.length+type.length));
          throw new PythonRuntimeError("TypeError",`${name}() argument 1 must be bytes, not ${type}`);
        }
        if(runtimeStringPayload(source)!==undefined)input=utf8(source);
        else{
          lease=context?.buffers?.acquireSimple(source);meter.checkpoint();
          if(lease===undefined){
            const type=typeName(source,"NoneType",100);
            meter.checkpoint(0,256+2*type.length);
            throw new PythonRuntimeError("TypeError",`a bytes-like object is required, not '${type}'`);
          }
        }
      }
      let errors:string|ImmutableBytes="strict";
      const errorArgument=args[1];
      if(errorArgument!==undefined&&errorArgument.kind!=="none"){
        const text=runtimeStringPayload(errorArgument);
        if(text===undefined){
          const type=typeName(errorArgument);
          // Admit after type-name services and before constructing a guest
          // exception; the finally block must still release any input export.
          meter.checkpoint(0,288+2*(name.length+type.length));
          throw new PythonRuntimeError("TypeError",`${name}() argument 2 must be str or None, not ${type}`);
        }
        if(context?.codecs!==undefined)errors=context.codecs.unicodeErrorPolicy(errorArgument,context);
        else{
        utf8(errorArgument);errors="";
        for(const point of text.value){meter.checkpoint(1,4);if(point===0){meter.checkpoint(0,192);throw new PythonRuntimeError("ValueError","embedded null character");}errors+=String.fromCodePoint(point);}
        }
      }
      if(input===undefined)input=(lease!==undefined?lease.copy():(native as Extract<RuntimeValue,{kind:"bytes"}>).value).toUint8Array(meter);
      meter.checkpoint();
      let output:Uint8Array;
      if(encode){
        meter.checkpoint(1,input.length*4);
        const buffer=new Uint8Array(input.length*4);let written=0;
        for(const byte of input){
          meter.checkpoint();
          if(byte>=32&&byte<127&&byte!==39&&byte!==92){buffer[written++]=byte;continue;}
          buffer[written++]=92;
          const short=byte===39||byte===92?byte:byte===9?116:byte===10?110:byte===13?114:undefined;
          if(short!==undefined){buffer[written++]=short;continue;}
          buffer[written++]=120;buffer[written++]="0123456789abcdef".charCodeAt(byte>>4);buffer[written++]="0123456789abcdef".charCodeAt(byte&15);
        }
        meter.checkpoint(written,written);output=buffer.slice(0,written);
      }else output=decodeByteEscape(input,errors,meter,message=>{
        if(context?.warn===undefined)throw Error("byte escape decoding requires an explicit warning service");
        context.warn("DeprecationWarning",message);
      });
      return values.tuple([values.bytes(output,encode&&output.length!==0?"fresh":"canonical"),values.integer(input.length)]);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{lease?.release();if(!fatal)meter.checkpoint();}
  }});
}
