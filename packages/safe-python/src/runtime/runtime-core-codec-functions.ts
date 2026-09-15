import type {ImmutableBytes} from "./immutable-bytes.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {encodeRuntimeCoreText,decodeRuntimeCoreText} from "./runtime-core-text-codec.js";
import {createRuntimeReadbufferEncode} from "./runtime-readbuffer-encode.js";
import {createRuntimeByteEscape} from "./runtime-byte-escape.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeTruth} from "./runtime-truth.js";
import {encodeUtf8} from "./utf8-encode.js";
import {decodeUtf7,encodeUtf7} from "./utf7.js";
import {decodeUnicodeEscape,encodeUnicodeEscape} from "./unicode-escape.js";
import type {BuiltinFunctionValue,RuntimeValue} from "./runtime-values.js";

/** Native bindings for core, UTF-7, Unicode escape and charmap codecs. The owning module supplies its
 * registry; no process-global codecs or host buffer conversion is consulted.
 * Core error names choose CPython's native fast paths independently of
 * registered callbacks. UTF-7 decoding resolves every policy in the registry;
 * its encoder needs no recovery. Charmap decoding resolves every error policy;
 * encoding retains native strict/ignore/replace/xmlcharrefreplace paths.
 * Callback lookup remains lazy.
 */
export function createRuntimeCoreCodecFunctions(registry:RuntimeCodecRegistry):ReadonlyMap<string,BuiltinFunctionValue> {
  const {values,meter}=registry,functions=new Map<string,BuiltinFunctionValue>();
  functions.set("readbuffer_encode",createRuntimeReadbufferEncode(values,meter));
  for(const operation of ["encode","decode"] as const)functions.set(`escape_${operation}`,createRuntimeByteEscape(operation,values,meter));
  for(const codec of ["ascii","latin_1","utf_8","utf_7","charmap","unicode_escape","raw_unicode_escape"] as const){
    for(const operation of ["encode","decode"] as const){
      const escape=codec==="unicode_escape"||codec==="raw_unicode_escape";
      const name=`${codec}_${operation}`,encode=operation==="encode",incremental=!encode&&(codec==="utf_8"||codec==="utf_7"||escape);
      meter.checkpoint(1,128);
      functions.set(name,values.builtinFunction({name,module:"_codecs",keywordValidation:"callee",textSignature:`($module, ${encode?"str":"data"}, errors=None${incremental?escape?", final=True":", final=False":codec==="charmap"?", mapping=None":""}, /)`,invoke(args,keywords,meter,context){
        let fatal=false,lease:RuntimeBufferLease|undefined;
        try{
          meter.checkpoint(1,128);
          if(keywords.items.size!==0){
            meter.checkpoint(0,256+2*name.length);
            throw new PythonRuntimeError("TypeError",`_codecs.${name}() takes no keyword arguments`);
          }
          const maximum=incremental||codec==="charmap"?3:2;
          if(args.length<1||args.length>maximum){
            meter.checkpoint(0,320+2*name.length);
            throw new PythonRuntimeError("TypeError",`${name} expected at ${args.length<1?"least 1 argument":`most ${maximum} arguments`}, got ${args.length}`);
          }
          const source=args[0],payload=runtimeStringPayload(source),native=source.kind==="instance"?source.native:source;
          let textBytes:Uint8Array|undefined;
          const typeName=(value:RuntimeValue,none="NoneType",maxBytes=50)=>diagnosticTypeName(value.kind==="none"?none:context?.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind),meter,maxBytes);
          if(encode){
            if(payload===undefined){
              const type=typeName(source,"None");
              meter.checkpoint(0,256+2*(name.length+type.length));
              throw new PythonRuntimeError("TypeError",`${name}() argument 1 must be str, not ${type}`);
            }
          }else if(escape&&payload!==undefined){
            try{textBytes=context===undefined?encodeUtf8(payload.value,"strict",meter):registry.unicodeUtf8(source,context).toUint8Array(meter);}
            catch(error){if(error instanceof PythonEncodeError&&context?.prepareException!==undefined)throw context.prepareException(error,{unicodeObject:source});throw error;}
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
              // Type resolution may use explicit services. Admit exception
              // storage after that boundary and before releasing any lease.
              meter.checkpoint(0,288+2*(name.length+type.length));
              throw new PythonRuntimeError("TypeError",`${name}() argument 2 must be str or None, not ${type}`);
            }
            if(context===undefined)throw Error("codec names require an interpreter invocation context");
            errors=registry.unicodeErrorPolicy(errorArgument,context);
            }
          const final=incremental&&args[2]!==undefined?runtimeTruth(args[2],meter,context):escape;
          meter.checkpoint();
          let recovery:RuntimeCodecRecovery|undefined;
          const mapping=args[2]??values.none;
          if(encode){
            let bytes:Uint8Array;
            if(escape)bytes=encodeUnicodeEscape(payload!.value,codec==="raw_unicode_escape",meter);
            else if(codec==="charmap"&&mapping.kind!=="none"){
              if(context===undefined)throw Error("charmap requires an interpreter invocation context");
              const policy=errors==="strict"||errors==="ignore"||errors==="replace"||errors==="xmlcharrefreplace"?errors:
                (error:PythonEncodeError)=>(recovery??=new RuntimeCodecRecovery(registry,errors,source,context)).encode(error);
              try{bytes=new RuntimeCharmap(values,meter).encode(payload!.value,mapping,policy,context);}
              catch(error){if(error instanceof PythonEncodeError&&context.prepareException!==undefined)throw context.prepareException(error,{unicodeObject:source});throw error;}
            }else bytes=codec==="utf_7"?encodeUtf7(payload!.value,meter):encodeRuntimeCoreText(codec==="charmap"?"latin_1":codec,source,errors,registry,context);
            const fresh=codec==="unicode_escape"||codec==="utf_7"||codec==="charmap"&&mapping.kind!=="none";
            return values.tuple([values.bytes(bytes,fresh&&bytes.length!==0?"fresh":"canonical"),values.integer(payload!.value.length)]);
          }
          // Acquire before errors/final, copy after their guest side effects,
          // and hold the export until all decoding and recovery have completed.
          const bytes=textBytes??(lease===undefined?(native as Extract<RuntimeValue,{kind:"bytes"}>).value:lease.copy()).toUint8Array(meter);
          meter.checkpoint();
          const recover=(error:Parameters<RuntimeCodecRecovery["decode"]>[0])=>{
            if(context===undefined)throw Error("codec recovery requires an interpreter invocation context");
            return (recovery??=new RuntimeCodecRecovery(registry,errors,values.none,context)).decode(error);
          };
          let decoded:ReturnType<typeof decodeUtf7>;
          if(escape)decoded=decodeUnicodeEscape(bytes,codec==="raw_unicode_escape",recover,meter,final,message=>{
            if(context?.warn===undefined)throw Error("Unicode escape decoding requires an explicit warning service");
            context.warn("DeprecationWarning",message);
          });
          else if(codec==="charmap"&&mapping.kind!=="none"){
            if(context===undefined)throw Error("charmap requires an interpreter invocation context");
            decoded=new RuntimeCharmap(values,meter).decode(bytes,mapping,recover,context);
          }else decoded=codec==="utf_7"?decodeUtf7(bytes,recover,meter,final):decodeRuntimeCoreText(codec==="charmap"?"latin_1":codec,bytes,errors,final,registry,context);
          // Native decoders return canonical empty/Latin-1 character strings,
          // including output produced by recovery or a replaced input buffer.
          return values.tuple([values.stringPoints(decoded.text,"canonical"),values.integer(decoded.consumed)]);
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally{lease?.release();if(!fatal)meter.checkpoint();}
      }}));
    }
  }
  return functions;
}
