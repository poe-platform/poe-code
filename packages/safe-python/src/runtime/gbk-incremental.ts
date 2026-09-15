import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {gbkCodec} from "./gbk-codec.js";

export const GbkIncrementalDecoder=DoubleByteIncrementalDecoder.bind(undefined,gbkCodec);
export const GbkIncrementalEncoder=DoubleByteIncrementalEncoder.bind(undefined,gbkCodec);
