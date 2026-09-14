import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import type {BuiltinInvocationContext} from "./runtime-values.js";
import type {Utf8DecodeRecovery} from "./utf8-decode.js";

/** Native source decoders use the caller's strict handler, with one lazy cache
 * per compilation. Canonical UTF-8 tokenizer validation never invokes this. */
export function createRuntimeSourceCodecRecovery(context:BuiltinInvocationContext|undefined):Utf8DecodeRecovery|undefined {
  const registry=context?.codecs;
  if(registry===undefined)return undefined;
  registry.meter.checkpoint(0,64);
  let recovery:RuntimeCodecRecovery|undefined;
  return error=>(recovery??=new RuntimeCodecRecovery(registry,"strict",registry.values.none,context!)).decode(error);
}
