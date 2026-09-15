import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {gb2312Codec} from "./gb2312-codec.js";

export type {DoubleByteDecoderState as Gb2312DecoderState} from "./double-byte-incremental-decoder.js";

export const Gb2312IncrementalDecoder=DoubleByteIncrementalDecoder.bind(undefined,gb2312Codec);
export const Gb2312IncrementalEncoder=DoubleByteIncrementalEncoder.bind(undefined,gb2312Codec);
