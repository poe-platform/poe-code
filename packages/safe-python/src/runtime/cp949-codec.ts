import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupCp949Character,lookupCp949Pair} from "./cp949-mapping.js";

/** CP949's stateless native machine uses the shared incremental/recovery
 * engines and independently pinned KS X 1001 and UHC mappings. */
export const cp949Codec=new DoubleByteCodec("cp949",lookupCp949Pair,lookupCp949Character);
