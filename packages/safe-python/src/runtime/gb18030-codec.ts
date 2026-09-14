import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupGb18030Character,lookupGb18030Pair,lookupGb18030Quad} from "./gb18030-mapping.js";

/** GB18030's digit-prefixed extension uses the native multibyte recovery and
 * incremental state machinery, with pinned mapping data in both directions. */
export const gb18030Codec=new DoubleByteCodec("gb18030",lookupGb18030Pair,lookupGb18030Character,{
  secondByteMin:0x30,secondByteMax:0x39,lookup:lookupGb18030Quad
});
