import {encodeHexadecimal,decodeHexadecimal} from "./hexadecimal.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeLength} from "./runtime-length.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {BuiltinFunctionValue,RuntimeValues} from "./runtime-values.js";

/** Native hexadecimal callables for binascii assembly. Buffer acquisition,
 * grouping conversion and separator length run in CPython order; snapshots
 * follow those callbacks so same-size mutations are visible. */
export function createRuntimeHexadecimalFunctions(values:RuntimeValues,meter:ExecutionMeter):readonly (readonly [string,BuiltinFunctionValue])[] {
  return (["hexlify","b2a_hex","unhexlify","a2b_hex"] as const).map(name=>{
    const encode=name==="hexlify"||name==="b2a_hex";
    const doc=encode?`Hexadecimal representation of binary data.\n\n  sep\n    An optional single character or byte to separate hex bytes.\n  bytes_per_sep\n    How many bytes between separators.  Positive values count from the\n    right, negative values count from the left.\n\nThe return value is a bytes object.  This function is also\navailable as "${name==="hexlify"?"b2a_hex":"hexlify"}()".${name==="hexlify"?"":"\n\nExample:\n>>> binascii.b2a_hex(b'\\xb9\\x01\\xef')\nb'b901ef'\n>>> binascii.hexlify(b'\\xb9\\x01\\xef', ':')\nb'b9:01:ef'\n>>> binascii.b2a_hex(b'\\xb9\\x01\\xef', b'_', 2)\nb'b9_01ef'"}`:
      `Binary data of hexadecimal representation.\n\nhexstr must contain an even number of hex digits (upper or lower case).${name==="unhexlify"?"":"\nThis function is also available as \"unhexlify()\"."}`;
    meter.checkpoint(1,128+doc.length*2);
    return [name,values.builtinFunction({name,module:"binascii",keywordValidation:"callee",doc,
      textSignature:encode?"($module, /, data, sep=<unrepresentable>, bytes_per_sep=1)":"($module, hexstr, /)",
      invoke(positional,keywords,meter,context){
        let lease:RuntimeBufferLease|undefined,fatal=false;
        try {
          meter.checkpoint(1,96);
          let args:readonly (typeof positional[number]|undefined)[]=positional;
          if(encode){
            const count=positional.length+keywords.items.size;
            if(count>3){meter.checkpoint(0,256);throw new PythonRuntimeError("TypeError",`${name}() takes at most 3 ${positional.length===0?"keyword ":""}arguments (${count} given)`);}
            if(positional.length===0){
              let supplied=false;
              for(const [key] of keywords.items.snapshot()){
                const payload=runtimeStringPayload(key);let spelling="";
                if(payload===undefined)throw new PythonRuntimeError("TypeError","keywords must be strings");
                for(const point of payload.value){meter.checkpoint(1,2);spelling+=String.fromCodePoint(point);}
                if(spelling==="data")supplied=true;
              }
              if(!supplied){meter.checkpoint(0,256);throw new PythonRuntimeError("TypeError",`${name}() missing required argument 'data' (pos 1)`);}
            }
            args=bindRuntimeClinicArguments(name,["data","sep","bytes_per_sep"],positional,keywords,values,meter,context);
          }else{
            if(keywords.items.size){meter.checkpoint(0,256);throw new PythonRuntimeError("TypeError",`binascii.${name}() takes no keyword arguments`);}
            if(positional.length!==1){meter.checkpoint(0,256);throw new PythonRuntimeError("TypeError",`binascii.${name}() takes exactly one argument (${positional.length} given)`);}
          }
          const source=args[0]!,text=encode?undefined:runtimeStringPayload(source);
          let input:Uint8Array|undefined;
          if(text!==undefined){
            meter.checkpoint(1,64+text.value.length);
            input=new Uint8Array(text.value.length);let index=0;
            for(const point of text.value){
              meter.checkpoint();
              if(point>127){meter.checkpoint(0,256);throw new PythonRuntimeError("ValueError","string argument should contain only ASCII characters");}
              input[index++]=point;
            }
          }
          let native=source.kind==="bytes"||context?.buffers===undefined?runtimeBytesPayload(source)?.value:undefined;
          if(input===undefined&&native===undefined){
            const type=()=>{
              const name=context?.buffers?.typeName?.(source)??context?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind==="instance"?source.type.value.diagnosticName:source.kind);
              // The name service can exhaust storage; admit the exception
              // after it returns and before constructing its diagnostic.
              meter.checkpoint(0,512);
              return diagnosticTypeName(name,meter,100);
            };
            try{
              lease=context?.buffers?.acquireSimple(source);meter.checkpoint();
            }catch(error){
              if(error instanceof ExecutionLimitError)throw error;
              meter.checkpoint();
              if(encode||!(error instanceof PythonRuntimeError||runtimeExceptionMatches(error,"BaseException",context)))throw error;
              // Classification can cancel execution; stop before diagnostic services.
              meter.checkpoint();
              throw new PythonRuntimeError("TypeError",`argument should be bytes, buffer or ASCII string, not '${type()}'`);
            }
            if(lease===undefined)throw new PythonRuntimeError("TypeError",encode?`a bytes-like object is required, not '${type()}'`:`argument should be bytes, buffer or ASCII string, not '${type()}'`);
          }
          let separator:number|undefined,group=1n;
          if(encode){
            if(args[2]!==undefined)group=runtimeIntegerIndex(args[2],meter,context?.integerIndex);
            if(BigInt.asIntN(32,group)!==group){meter.checkpoint(0,256);throw new PythonRuntimeError("OverflowError","Python int too large to convert to C int");}
            if(args[1]!==undefined){
              if(BigInt(runtimeLength(args[1],meter,undefined,context))!==1n){meter.checkpoint(0,256);throw new PythonRuntimeError("ValueError","sep must be length 1.");}
              const payload=runtimeStringPayload(args[1])??runtimeBytesPayload(args[1]);
              if(payload===undefined){meter.checkpoint(0,256);throw new PythonRuntimeError("TypeError","sep must be str or bytes.");}
              if(payload.kind==="str")for(const point of payload.value){meter.checkpoint();if(point>255){meter.checkpoint(0,256);throw new PythonRuntimeError("ValueError","sep must be ASCII.");}}
              separator=payload.value.length===0?0:payload.kind==="str"?payload.value.codePointAt(0n,meter):payload.value.byteAt(0n,meter);
            }
          }
          meter.checkpoint();
          if(lease!==undefined)native=lease.copy();
          meter.checkpoint();
          input??=native!.toUint8Array(meter);
          return values.bytes(encode?encodeHexadecimal(input,separator,Number(group),meter):decodeHexadecimal(input,meter));
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally {lease?.release();if(!fatal)meter.checkpoint();}
      }
    })] as const;
  });
}
