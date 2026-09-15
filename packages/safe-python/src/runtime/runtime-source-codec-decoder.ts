import type {SourceByteDecoder} from "./byte-source-decoding.js";
import {ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {requireRuntimeTextCodecResult} from "./runtime-text-codec-result.js";
import type {BuiltinInvocationContext} from "./runtime-values.js";

/** Bind tokenizer codec dispatch to the calling interpreter and its explicit
 * ownerless-buffer provider. No bytes substitute may stand in for memoryview.
 * Native tokenizer fast paths are selected by decodeByteSource, not here. */
export function createRuntimeSourceCodecDecoder(context:BuiltinInvocationContext|undefined):SourceByteDecoder|undefined {
  const registry=context?.codecs,buffers=context?.buffers;
  if(registry===undefined)return undefined;
  registry.meter.checkpoint(0,64);
  return (encoding,source,meter)=>{
    let fatal=false;
    try {
      meter.checkpoint();
      // An unavailable platform service is an implementation blocker, not a
      // registry miss. Keep native tokenizer paths usable, but never disable
      // the caller's registered search functions silently at binding time.
      if(buffers?.createReadOnlyView===undefined){
        meter.checkpoint(0,192);
        throw new Error("source codec decoding requires an ownerless memoryview provider");
      }
      const view=buffers.createReadOnlyView(ImmutableBytes.copyOf(source,meter));
      meter.checkpoint();
      const result=registry.transform("decode",view,encoding,undefined,context!,true);
      requireRuntimeTextCodecResult(result,"decode",encoding,meter,context);
      return runtimeStringPayload(result)!.value;
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)meter.checkpoint();}
  };
}
