import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupGbkCharacter,lookupGbkPair} from "./gbk-mapping.js";

/** Native GBK shares GB2312's state machine with independent pinned mappings. */
export const gbkCodec=new DoubleByteCodec("gbk",lookupGbkPair,lookupGbkCharacter);
export const {decode:decodeGbk,encode:encodeGbk}=gbkCodec;
