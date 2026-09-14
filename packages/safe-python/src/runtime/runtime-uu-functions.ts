import {encodeUu,decodeUu} from "./uuencode.js";
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

/** Native UU line bindings over pinned kernels. Buffer ownership spans option
 * conversion, including failures; complete binascii publication owns the error
 * classes and module object. No host codec or filesystem is consulted. */
export function createRuntimeUuFunctions(values:RuntimeValues,meter:ExecutionMeter):readonly (readonly [string,BuiltinFunctionValue])[] {
  return (["a2b_uu","b2a_uu"] as const).map(name=>{
    const encode=name==="b2a_uu";
    meter.checkpoint(1,128);
    return [name,values.builtinFunction({name,module:"binascii",keywordValidation:"callee",
      doc:encode?"Uuencode line of data.":"Decode a line of uuencoded data.",
      textSignature:encode?"($module, data, /, *, backtick=False)":"($module, data, /)",
      invoke(positional,keywords,meter,context){
        let lease:RuntimeBufferLease|undefined,fatal=false;
        try {
          meter.checkpoint(1,96);
          if(!encode){
            if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError","binascii.a2b_uu() takes no keyword arguments");
            if(positional.length!==1)throw new PythonRuntimeError("TypeError",`binascii.a2b_uu() takes exactly one argument (${positional.length} given)`);
          }else{
            const count=positional.length+keywords.items.size;
            if(count>2)throw new PythonRuntimeError("TypeError",`b2a_uu() takes at most 2 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
            if(positional.length!==1)throw new PythonRuntimeError("TypeError",`b2a_uu() takes exactly 1 positional argument (${positional.length} given)`);
          }
          const args=encode?bindRuntimeClinicArguments(name,["","backtick"],positional,keywords,values,meter,context):positional;
          const source=args[0]!,text=encode?undefined:runtimeStringPayload(source);
          let input:Uint8Array|undefined;
          if(text!==undefined){
            meter.checkpoint(1,64+text.value.length);
            input=new Uint8Array(text.value.length);let index=0;
            for(const point of text.value){
              meter.checkpoint();
              if(point>127)throw new PythonRuntimeError("ValueError","string argument should contain only ASCII characters");
              input[index++]=point;
            }
          }
          let native=source.kind==="bytes"||context?.buffers===undefined?runtimeBytesPayload(source)?.value:undefined;
          if(input===undefined&&native===undefined){
            const type=()=>diagnosticTypeName(context?.buffers?.typeName?.(source)??context?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind==="instance"?source.type.value.diagnosticName:source.kind),meter,100);
            try {
              lease=context?.buffers?.acquireSimple(source);meter.checkpoint();
            }catch(error){
              if(error instanceof ExecutionLimitError)throw error;
              meter.checkpoint();
              if(encode)throw error;
              const guest=error instanceof PythonRuntimeError||runtimeExceptionMatches(error,"BaseException",context);
              // Classification is an interpreter service boundary too. Observe
              // cancellation before requesting a diagnostic from another hook.
              meter.checkpoint();
              if(!guest)throw error;
              throw new PythonRuntimeError("TypeError",`argument should be bytes, buffer or ASCII string, not '${type()}'`);
            }
            if(lease===undefined)throw new PythonRuntimeError("TypeError",encode?`a bytes-like object is required, not '${type()}'`:`argument should be bytes, buffer or ASCII string, not '${type()}'`);
          }
          const flag=args[1]===undefined?false:context?.truth===undefined?runtimeTruth(args[1],meter,context):context.truth(args[1]);
          meter.checkpoint();
          if(lease!==undefined)native=lease.copy();
          meter.checkpoint();
          input??=native!.toUint8Array(meter);
          return values.bytes(encode?encodeUu(input,flag,meter):decodeUu(input,meter));
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally {lease?.release();if(!fatal)meter.checkpoint();}
      }
    })] as const;
  });
}
