import {encodeBase64,decodeBase64} from "./base64.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeTruth} from "./runtime-truth.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {BuiltinFunctionValue,RuntimeValues} from "./runtime-values.js";

/** Binascii Base64 bindings over the pinned byte kernels. The buffer stays
 * exported during keyword truth conversion; copying afterwards observes guest
 * mutations. Module assembly owns native exception and module publication. */
export function createRuntimeBase64Functions(values:RuntimeValues,meter:ExecutionMeter):readonly (readonly [string,BuiltinFunctionValue])[] {
  return (["a2b_base64","b2a_base64"] as const).map(name=>{
    const encode=name==="b2a_base64",option=encode?"newline":"strict_mode";
    meter.checkpoint(1,128);
    return [name,values.builtinFunction({name,module:"binascii",keywordValidation:"callee",
      doc:encode?"Base64-code line of data.":"Decode a line of base64 data.\n\n  strict_mode\n    When set to True, bytes that are not part of the base64 standard are not allowed.\n    The same applies to excess data after padding (= / ==).",
      textSignature:`($module, data, /, *, ${option}=${encode?"True":"False"})`,
      invoke(positional,keywords,meter,context){
        let lease:RuntimeBufferLease|undefined,fatal=false;
        try {
          meter.checkpoint(1,96);
          const count=positional.length+keywords.items.size;
          // Rejected binding owns an exception and formatted diagnostic in
          // addition to invocation storage. Admit it before it can escape.
          if(count>2||positional.length!==1)meter.checkpoint(0,256);
          if(count>2)throw new PythonRuntimeError("TypeError",`${name}() takes at most 2 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
          if(positional.length!==1)throw new PythonRuntimeError("TypeError",`${name}() takes exactly 1 positional argument (${positional.length} given)`);
          const args=bindRuntimeClinicArguments(name,["",option],positional,keywords,values,meter,context);
          const source=args[0]!,text=encode?undefined:runtimeStringPayload(source);
          let input:Uint8Array|undefined;
          if(text!==undefined){
            meter.checkpoint(1,64+text.value.length);
            input=new Uint8Array(text.value.length);let index=0;
            for(const point of text.value){
              meter.checkpoint();
              if(point>127){
                meter.checkpoint(0,256);
                throw new PythonRuntimeError("ValueError","string argument should contain only ASCII characters");
              }
              input[index++]=point;
            }
          }
          let native=source.kind==="bytes"||context?.buffers===undefined?runtimeBytesPayload(source)?.value:undefined;
          if(input===undefined&&native===undefined){
            const type=()=>{
              const name=context?.buffers?.typeName?.(source)??context?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind==="instance"?source.type.value.diagnosticName:source.kind);
              // The name service may exhaust storage. The escaping exception
              // and its precision-limited diagnostic still need admission.
              meter.checkpoint(0,512);
              return diagnosticTypeName(name,meter,100);
            };
            try {
              lease=context?.buffers?.acquireSimple(source);meter.checkpoint();
            } catch(error){
              if(error instanceof ExecutionLimitError)throw error;
              meter.checkpoint();
              if(encode||!(error instanceof PythonRuntimeError||runtimeExceptionMatches(error,"BaseException",context)))throw error;
              // Classification can cancel execution; stop before diagnostic services.
              meter.checkpoint();
              throw new PythonRuntimeError("TypeError",`argument should be bytes, buffer or ASCII string, not '${type()}'`);
            }
            if(lease===undefined)throw new PythonRuntimeError("TypeError",encode?`a bytes-like object is required, not '${type()}'`:`argument should be bytes, buffer or ASCII string, not '${type()}'`);
          }
          const flag=args[1]===undefined?encode:context?.truth===undefined?runtimeTruth(args[1],meter,context):context.truth(args[1]);
          meter.checkpoint();
          if(lease!==undefined)native=lease.copy();
          meter.checkpoint();
          input??=native!.toUint8Array(meter);
          return values.bytes(encode?encodeBase64(input,flag,meter):decodeBase64(input,flag,meter));
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally {lease?.release();if(!fatal)meter.checkpoint();}
      }
    })] as const;
  });
}
