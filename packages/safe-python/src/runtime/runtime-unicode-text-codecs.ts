import type {CodePointString} from "./code-point-string.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {Utf8DecodeErrors,Utf8Decoded,Utf8DecodeRecovery} from "./utf8-decode.js";
import type {Utf8EncodeErrors,Utf8EncodeRecovery} from "./utf8-encode.js";
import {decodeUtf7,encodeUtf7} from "./utf7.js";
import {decodeWideUnicode,encodeWideUnicode,type UnicodeByteOrder} from "./utf-wide.js";
import {decodeUnicodeEscape,encodeUnicodeEscape} from "./unicode-escape.js";
import {decodePunycode,encodePunycode} from "./punycode.js";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";
import {singleByteAliases} from "./single-byte-aliases.js";
import {unicodeCodecName} from "../unicode-codec-name.js";
import type {BuiltinInvocationContext} from "./runtime-values.js";
import {decodeRuntimeCoreText} from "./runtime-core-text-codec.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";

interface UnicodeTextCodec {
  readonly name:string;
  readonly aliases:readonly string[];
  /** Native encoders that allocate instead of using the one-byte singleton. */
  readonly freshEncodedBytes?:boolean;
  readonly encode:(text:CodePointString,errors:Utf8EncodeErrors,meter:ExecutionMeter,recover?:Utf8EncodeRecovery)=>Uint8Array;
  readonly decode:(bytes:Uint8Array,errors:Utf8DecodeErrors,meter:ExecutionMeter,invocation?:BuiltinInvocationContext,recover?:Utf8DecodeRecovery)=>Utf8Decoded;
}

/** Package-owned kernels shared by str.encode, bytes.decode and str(bytes).
 * Alias spellings are pinned to CPython's encodings.aliases inventory. */
export const unicodeTextCodecs:readonly UnicodeTextCodec[]=[
  ...singleByteTables.map((table):UnicodeTextCodec=>({
    name:table.name,aliases:singleByteAliases[table.name],freshEncodedBytes:true,
    encode:(text,errors,meter,recover)=>new SingleByteTableCodec(table,meter).encode(text,recover!==undefined&&errors!=="strict"&&errors!=="ignore"&&errors!=="replace"&&errors!=="xmlcharrefreplace"?recover:errors,meter,point=>unicodeCodecName(point,meter)),
    decode:(bytes,errors,meter,_invocation,recover)=>new SingleByteTableCodec(table,meter).decode(bytes,recover??errors,meter),
  })),
  {name:"punycode",aliases:[],encode:(text,_errors,meter)=>encodePunycode(text,meter),decode:(bytes,errors,meter,invocation)=>({
    text:decodePunycode(bytes,errors,meter,invocation?.codecs===undefined?undefined:prefix=>{
      try{return decodeRuntimeCoreText("ascii",prefix,errors,true,invocation.codecs!,invocation).text;}
      catch(error){
        if(!runtimeExceptionMatches(error,"UnicodeDecodeError",invocation))throw error;
        if(invocation.rewriteDecodeError===undefined)throw Error("Punycode requires interpreter exception rewriting");
        return invocation.rewriteDecodeError(error,"ascii",invocation.codecs!.values.bytes(bytes),invocation);
      }
    }),consumed:bytes.length
  })},
  {name:"utf_7",aliases:["u7","unicode_1_1_utf_7","utf7"],freshEncodedBytes:true,encode:(text,_errors,meter)=>encodeUtf7(text,meter),decode:(bytes,errors,meter,_invocation,recover)=>decodeUtf7(bytes,recover??errors,meter)},
  ...[false,true].map((raw):UnicodeTextCodec=>({
    name:raw?"raw_unicode_escape":"unicode_escape",aliases:[],freshEncodedBytes:!raw,
    encode:(text,_errors,meter)=>encodeUnicodeEscape(text,raw,meter),
    decode:(bytes,errors,meter,invocation,recover)=>decodeUnicodeEscape(bytes,raw,recover??errors,meter,true,message=>{
      if(invocation?.warn===undefined)throw new Error("Unicode escape decoding requires an explicit warning service");
      invocation.warn("DeprecationWarning",message);
    }),
  })),
  ...([
    [16,0,"utf_16",["u16","utf16"]],
    [16,1,"utf_16_be",["unicodebigunmarked","utf_16be"]],
    [16,-1,"utf_16_le",["unicodelittleunmarked","utf_16le"]],
    [32,0,"utf_32",["u32","utf32"]],
    [32,1,"utf_32_be",["utf_32be"]],
    [32,-1,"utf_32_le",["utf_32le"]],
  ] satisfies [16|32,UnicodeByteOrder,string,string[]][]).map(([width,order,name,aliases]):UnicodeTextCodec=>({
    name,aliases,
    encode:(text,errors,meter,recover)=>encodeWideUnicode(text,width,order,recover??errors,meter),
    decode:(bytes,errors,meter,_invocation,recover)=>decodeWideUnicode(bytes,width,order,recover??errors,meter),
  })),
];
