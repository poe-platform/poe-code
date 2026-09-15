import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupHkscsCharacter,lookupHkscsPair,lookupHkscsSequence} from "./hkscs-mapping.js";

/** Pinned HKSCS directional mappings, including two-code-point expansions and
 * encoder prefixes that remain pending until another character or final flush. */
export const hkscsCodec=new DoubleByteCodec("big5hkscs",lookupHkscsPair,lookupHkscsCharacter,undefined,{
  prefixes:[0xca,0xea],lookup:lookupHkscsSequence
});
