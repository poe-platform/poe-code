import {CodePointString} from "./code-point-string.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {ImmutableBytes} from "./immutable-bytes.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";
import {decodeUtf8} from "./utf8-decode.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";

/** Instances returned here have validated native str or bytes storage. */
export type RuntimePath=Extract<RuntimeValue,{kind:"str"|"bytes"|"instance"}>;
export type FileSystemNameDecoder=(bytes:ImmutableBytes,meter:ExecutionMeter)=>CodePointString;

/** os.fspath protocol only: preserve str/bytes identities, otherwise call the
 * type-level __fspath__ once. No normalization, decoding, NUL rejection or I/O. */
export function runtimeFileSystemPath(value:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):RuntimePath {
  let fatal=false;
  try {
    meter.checkpoint();
    if(runtimeStringPayload(value)!==undefined||runtimeBytesPayload(value)!==undefined)return value as RuntimePath;
    const method=invocation?.lookupSpecial?.(value,"__fspath__");
    meter.checkpoint();
    if(method===undefined){
      const name=diagnosticTypeName(invocation?.typeName?.(value)??(value.kind==="none"?"NoneType":value.kind==="not-implemented"?"NotImplementedType":value.kind),meter);
      meter.checkpoint(0,256+2*name.length);
      throw new PythonRuntimeError("TypeError",`expected str, bytes or os.PathLike object, not ${name}`);
    }
    meter.checkpoint(0,32);
    const result=invocation!.call(method,[]);
    meter.checkpoint();
    if(runtimeStringPayload(result)!==undefined||runtimeBytesPayload(result)!==undefined)return result as RuntimePath;
    const owner=diagnosticTypeName(invocation?.typeName?.(value)??value.kind,meter);
    const name=diagnosticTypeName(invocation?.typeName?.(result)??(result.kind==="none"?"NoneType":result.kind==="not-implemented"?"NotImplementedType":result.kind),meter);
    meter.checkpoint(0,256+2*(owner.length+name.length));
    throw new PythonRuntimeError("TypeError",`expected ${owner}.__fspath__() to return str or bytes, not ${name}`);
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}

/** Decode a filesystem name without losing Python code-point identity. The
 * default is UTF-8/surrogateescape; other filesystem encodings are explicit
 * host capabilities. This does not authorize a path or open a file. Adapters
 * must not assume a UTF-16 round trip preserves separate surrogate points. */
export function decodeRuntimeFileSystemName(value:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext,decode?:FileSystemNameDecoder):CodePointString {
  let fatal=false;
  try {
    const path=runtimeFileSystemPath(value,meter,invocation);
    const text=runtimeStringPayload(path);
    if(text!==undefined)return text.value;
    const bytes=runtimeBytesPayload(path)!.value;
    if(decode!==undefined)return decode(bytes,meter);
    // Decoder buffers charge themselves; reserve per-unit temporary records too.
    meter.checkpoint(1,128+64*bytes.length);
    return decodeUtf8(bytes.toUint8Array(meter),"surrogateescape",meter).text;
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}
