import {crc32,crcHqx} from "./crc.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import type {BuiltinFunctionValue,RuntimeValues} from "./runtime-values.js";

/** Native checksum bindings for complete binascii module assembly. Acquisition
 * precedes seed conversion; copying afterwards observes mutations performed by
 * __index__ while the export remains pinned. No host checksum is consulted. */
export function createRuntimeCrcFunctions(values:RuntimeValues,meter:ExecutionMeter):readonly (readonly [string,BuiltinFunctionValue])[] {
  return (["crc32","crc_hqx"] as const).map(name=>{
    meter.checkpoint(1,128);
    return [name,values.builtinFunction({name,module:"binascii",keywordValidation:"callee",
      doc:name==="crc32"?"Compute CRC-32 incrementally.":"Compute CRC-CCITT incrementally.",
      textSignature:name==="crc32"?"($module, data, crc=0, /)":"($module, data, crc, /)",
      invoke(args,keywords,meter,context){
        let fatal=false,lease:RuntimeBufferLease|undefined;
        try {
          meter.checkpoint(1,96);
          if(keywords.items.size)throw new PythonRuntimeError("TypeError",`binascii.${name}() takes no keyword arguments`);
          if(name==="crc_hqx"&&args.length!==2)throw new PythonRuntimeError("TypeError",`crc_hqx expected 2 arguments, got ${args.length}`);
          if(args.length<1||args.length>2)throw new PythonRuntimeError("TypeError",`crc32 expected at ${args.length<1?"least 1 argument":"most 2 arguments"}, got ${args.length}`);
          const source=args[0],payload=runtimeBytesPayload(source);
          // Subclasses may supply their own buffer slots. Only exact bytes can
          // bypass an installed provider; without one native bytes still work.
          let bytes=source.kind==="bytes"||context?.buffers===undefined?payload?.value:undefined;
          if(bytes===undefined){
            lease=context?.buffers?.acquireSimple(source);meter.checkpoint();
            if(lease===undefined){
              const type=context?.buffers?.typeName?.(source)??context?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind==="instance"?source.type.value.diagnosticName:source.kind);
              throw new PythonRuntimeError("TypeError",`a bytes-like object is required, not '${diagnosticTypeName(type,meter,100)}'`);
            }
          }
          const seed=args.length===1?0n:runtimeIntegerIndex(args[1],meter,context?.integerIndex);
          meter.checkpoint();
          const initial=Number(BigInt.asUintN(32,seed));
          if(lease!==undefined)bytes=lease.copy();
          meter.checkpoint();
          const input=bytes!.toUint8Array(meter);
          return values.integer(name==="crc32"?crc32(input,initial,meter):crcHqx(input,initial,meter));
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally {lease?.release();if(!fatal)meter.checkpoint();}
      }
    })] as const;
  });
}
