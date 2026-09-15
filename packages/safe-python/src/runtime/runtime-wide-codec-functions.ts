import type {ImmutableBytes} from "./immutable-bytes.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeTruth} from "./runtime-truth.js";
import {decodeWideUnicode,encodeWideUnicode} from "./utf-wide.js";
import type {BuiltinFunctionValue,RuntimeValue} from "./runtime-values.js";

/** CPython's native UTF-16/32 entry points, backed by pinned little-endian
 * kernels and interpreter-owned recovery. Extended decoding preserves the full
 * C-int byteorder argument even though the kernel only needs its sign. */
export function createRuntimeWideCodecFunctions(registry:RuntimeCodecRegistry):ReadonlyMap<string,BuiltinFunctionValue>{
  const {values,meter}=registry,functions=new Map<string,BuiltinFunctionValue>();
  for(const width of [16,32] as const){
    for(const suffix of ["","_le","_be","_ex"] as const){
      for(const operation of suffix==="_ex"?["decode"] as const:["encode","decode"] as const){
        const name=`utf_${width}${suffix}_${operation}`,encode=operation==="encode",extended=suffix==="_ex";
        const hasOrder=extended||encode&&suffix==="",maximum=encode?hasOrder?3:2:extended?4:3;
        const signature=encode?`($module, str, errors=None${hasOrder?", byteorder=0":""}, /)`
          :extended?"($module, data, errors=None, byteorder=0, final=False,\n                 /)":"($module, data, errors=None, final=False, /)";
        meter.checkpoint(1,128);
        functions.set(name,values.builtinFunction({name,module:"_codecs",keywordValidation:"callee",textSignature:signature,invoke(args,keywords,meter,context){
          let fatal=false,lease:RuntimeBufferLease|undefined;
          try{
            meter.checkpoint(1,128);
            if(keywords.items.size!==0){
              meter.checkpoint(0,256+2*name.length);
              throw new PythonRuntimeError("TypeError",`_codecs.${name}() takes no keyword arguments`);
            }
            if(args.length<1||args.length>maximum){
              meter.checkpoint(0,320+2*name.length);
              throw new PythonRuntimeError("TypeError",`${name} expected at ${args.length<1?"least 1 argument":`most ${maximum} arguments`}, got ${args.length}`);
            }
            const source=args[0],payload=runtimeStringPayload(source),native=source.kind==="instance"?source.native:source;
            const typeName=(value:RuntimeValue,none="NoneType",maxBytes=50)=>diagnosticTypeName(value.kind==="none"?none:context?.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind),meter,maxBytes);
            if(encode){
              if(payload===undefined){
                const type=typeName(source,"None");
                meter.checkpoint(0,256+2*(name.length+type.length));
                throw new PythonRuntimeError("TypeError",`${name}() argument 1 must be str, not ${type}`);
              }
            }else if(native?.kind!=="bytes"||source.kind!=="bytes"&&context?.buffers!==undefined){
              lease=context?.buffers?.acquireSimple(source);
              meter.checkpoint();
              if(lease===undefined){
                const type=typeName(source,"NoneType",100);
                meter.checkpoint(0,256+2*type.length);
                throw new PythonRuntimeError("TypeError",`a bytes-like object is required, not '${type}'`);
              }
            }
            let errors:string|ImmutableBytes="strict";
            const errorArgument=args[1];
            if(errorArgument!==undefined&&errorArgument.kind!=="none"){
              const text=runtimeStringPayload(errorArgument);
              if(text===undefined){
                const type=typeName(errorArgument,"None");
                meter.checkpoint(0,288+2*(name.length+type.length));
                throw new PythonRuntimeError("TypeError",`${name}() argument 2 must be str or None, not ${type}`);
              }
              if(context===undefined)throw Error("codec names require an interpreter invocation context");
            errors=registry.unicodeErrorPolicy(errorArgument,context);
            }
            let order=suffix==="_le"?-1:suffix==="_be"?1:0;
            if(hasOrder&&args[2]!==undefined){
              const integer=runtimeIntegerIndex(args[2],meter,context?.integerIndex);
              if(integer< -2147483648n||integer>2147483647n){
                // __index__ can use explicit services and exhaust storage.
                // Admit this native rejection after it returns, before the
                // exception can escape or the pinned buffer is released.
                meter.checkpoint(0,272);
                throw new PythonRuntimeError("OverflowError","Python int too large to convert to C int");
              }
              order=Number(integer);
            }
            const finalArgument=args[extended?3:2],final=!encode&&finalArgument!==undefined?runtimeTruth(finalArgument,meter,context):false;
            meter.checkpoint();
            const byteorder=order<0?-1:order>0?1:0;
            let recovery:RuntimeCodecRecovery|undefined;
            if(encode){
              const bytes=encodeWideUnicode(payload!.value,width,byteorder,error=>{
                if(context===undefined)throw Error("codec recovery requires an interpreter invocation context");
                return (recovery??=new RuntimeCodecRecovery(registry,errors,source,context)).encode(error);
              },meter);
              return values.tuple([values.bytes(bytes),values.integer(payload!.value.length)]);
            }
            // Buffer acquisition precedes argument callbacks; copying follows
            // them. Keep the export pinned throughout decoding and recovery.
            const bytes=lease===undefined?(native as Extract<RuntimeValue,{kind:"bytes"}>).value:lease.copy();
            meter.checkpoint();
            const decoded=decodeWideUnicode(bytes.toUint8Array(meter),width,byteorder,error=>{
              if(context===undefined)throw Error("codec recovery requires an interpreter invocation context");
              return (recovery??=new RuntimeCodecRecovery(registry,errors,values.none,context)).decode(error);
            },meter,final);
            const result=[values.stringPoints(decoded.text,"canonical"),values.integer(decoded.consumed)];
            if(extended)result.push(values.integer(order===0?decoded.byteorder:order));
            return values.tuple(result);
          }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
          finally{lease?.release();if(!fatal)meter.checkpoint();}
        }}));
      }
    }
  }
  return functions;
}
