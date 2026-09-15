import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupGb2312Character,lookupGb2312Pair} from "./gb2312-mapping.js";

export type {MultibyteErrors,MultibyteDecodeRecovery,MultibyteEncodeRecovery} from "./double-byte-codec.js";

/** GB2312 has no shift state or flush bytes. Recovery is interpreter-owned. */
export const gb2312Codec=new DoubleByteCodec("gb2312",lookupGb2312Pair,lookupGb2312Character);
export const {decode:decodeGb2312,encode:encodeGb2312}=gb2312Codec;
