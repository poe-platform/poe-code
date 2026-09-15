import {encodeQuotedPrintable,decodeQuotedPrintable} from "./quoted-printable.js";
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

/** Quoted-printable native bindings. Export ownership spans all option
 * conversions; copying afterwards observes guest buffer mutations. The module
 * loader owns public binascii publication, never ambient host imports. */
export function createRuntimeQuotedPrintableFunctions(values:RuntimeValues,meter:ExecutionMeter):readonly (readonly [string,BuiltinFunctionValue])[] {
  return (["a2b_qp","b2a_qp"] as const).map(name=>{
    const encode=name==="b2a_qp",parameters=encode?["data","quotetabs","istext","header"]:["data","header"];
    meter.checkpoint(1,128);
    return [name,values.builtinFunction({name,module:"binascii",keywordValidation:"callee",
      doc:encode?"Encode a string using quoted-printable encoding.\n\nOn encoding, when istext is set, newlines are not encoded, and white\nspace at end of lines is.  When istext is not set, \\r and \\n (CR/LF)\nare both encoded.  When quotetabs is set, space and tabs are encoded.":"Decode a string of qp-encoded data.",
      textSignature:encode?"($module, /, data, quotetabs=False, istext=True, header=False)":"($module, /, data, header=False)",
      invoke(positional,keywords,meter,context){
        let lease:RuntimeBufferLease|undefined,fatal=false;
        try {
          meter.checkpoint(1,96);
          const count=positional.length+keywords.items.size;
          if(count>parameters.length)throw new PythonRuntimeError("TypeError",`${name}() takes at most ${parameters.length} ${positional.length===0?"keyword ":""}arguments (${count} given)`);
          // Clinic checks the required native Unicode name before diagnosing
          // unexpected keywords; keyword subclasses cannot override binding.
          if(positional.length===0){
            const data=values.string("data").value;
            let present=false;
            for(const [key] of keywords.items.snapshot()){
              meter.checkpoint();
              if(runtimeStringPayload(key)?.value.compare(data,meter)===0){present=true;break;}
            }
            if(!present)throw new PythonRuntimeError("TypeError",`${name}() missing required argument 'data' (pos 1)`);
          }
          const args=bindRuntimeClinicArguments(name,parameters,positional,keywords,values,meter,context);
          const source=args[0]!,text=encode?undefined:runtimeStringPayload(source);
          let input:Uint8Array|undefined;
          if(text!==undefined){
            meter.checkpoint(1,text.value.length);
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
          const flags:boolean[]=[];
          for(let index=1;index<parameters.length;index++){
            const value=args[index];
            flags.push(value===undefined?parameters[index]==="istext":context?.truth===undefined?runtimeTruth(value,meter,context):context.truth(value));
            meter.checkpoint();
          }
          meter.checkpoint();
          if(lease!==undefined)native=lease.copy();
          meter.checkpoint();
          input??=native!.toUint8Array(meter);
          return values.bytes(encode?encodeQuotedPrintable(input,{quoteTabs:flags[0],isText:flags[1],header:flags[2]},meter):decodeQuotedPrintable(input,flags[0],meter));
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally {lease?.release();if(!fatal)meter.checkpoint();}
      }
    })] as const;
  });
}
