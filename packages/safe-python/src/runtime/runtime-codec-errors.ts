import {unicodeCodecName} from "../unicode-codec-name.js";
import {PythonRuntimeError} from "./error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload,type RuntimeExceptionState} from "./runtime-exception-state.js";
import {runtimeQualifiedTypeNamePoints} from "./runtime-qualified-type-name.js";
import {PythonUnicodeMessageError} from "./unicode-message-error.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {hasRuntimeInstanceAttributes,type BuiltinInvocationContext,type RuntimeValue,type RuntimeValues} from "./runtime-values.js";
import {encodeUtf8} from "./utf8-encode.js";

export const standardCodecErrorDocumentation={
  strict:"Implements the 'strict' error handling, which raises a UnicodeError on coding errors.",
  ignore:"Implements the 'ignore' error handling, which ignores malformed data and continues.",
  replace:"Implements the 'replace' error handling, which replaces malformed data with a replacement marker.",
  xmlcharrefreplace:"Implements the 'xmlcharrefreplace' error handling, which replaces an unencodable character with the appropriate XML character reference.",
  backslashreplace:"Implements the 'backslashreplace' error handling, which replaces malformed data with a backslashed escape sequence.",
  namereplace:"Implements the 'namereplace' error handling, which replaces an unencodable character with a \\N{...} escape sequence.",
  surrogatepass:undefined,
  surrogateescape:undefined
};
export type StandardCodecError=keyof typeof standardCodecErrorDocumentation;

function stringMember(state:RuntimeExceptionState,name:string,meter:ExecutionMeter){
  const value=state.member(name,meter);
  if(value===undefined){
    meter.checkpoint(0,192+2*name.length);
    throw new PythonRuntimeError("TypeError",`UnicodeError '${name}' attribute is not set`);
  }
  const text=runtimeStringPayload(value);
  if(text===undefined){
    meter.checkpoint(0,192+2*name.length);
    throw new PythonRuntimeError("TypeError",`UnicodeError '${name}' attribute must be a string`);
  }
  return text.value;
}

/** Unicode-error C getters read native fields, bypassing descriptors and guest
 * __getattribute__. Their clamped ranges are not Python slice indices. */
function errorRange(state:RuntimeExceptionState,decode:boolean,meter:ExecutionMeter){
  const object=state.member("object",meter);
  if(object===undefined){
    meter.checkpoint(0,192);
    throw new PythonRuntimeError("TypeError","UnicodeError 'object' attribute is not set");
  }
  const native=object.kind==="instance"?object.native:object;
  const bytes=decode&&native?.kind==="bytes"?native.value:undefined;
  const text=decode?undefined:runtimeStringPayload(object)?.value;
  if(bytes===undefined&&text===undefined){
    meter.checkpoint(0,192);
    throw new PythonRuntimeError("TypeError",`UnicodeError 'object' attribute must be ${decode?"a bytes":"a string"}`);
  }
  const length=(bytes??text)!.length;
  const a=state.member("start",meter),b=state.member("end",meter);
  const rawStart=a?.kind==="int"?a.value:0n,rawEnd=b?.kind==="int"?b.value:0n;
  const start=Number(rawStart<0n?0n:rawStart>=BigInt(length)?BigInt(Math.max(0,length-1)):rawStart);
  const end=Number(rawEnd<1n?BigInt(Math.min(1,length)):rawEnd>BigInt(length)?BigInt(length):rawEnd);
  return {start,end,length,count:Math.max(0,end-start),point:(index:number)=>bytes===undefined?text!.codePointAt(BigInt(index),meter):bytes.byteAt(BigInt(index),meter)};
}

/** This recognizer intentionally differs from registry normalization, including
 * case-sensitive cp65001 and C-string truncation at NUL. Native UTF-16/32 use
 * the pinned little-endian reference platform, never the host platform. */
function surrogateEncoding(state:RuntimeExceptionState,meter:ExecutionMeter,context:BuiltinInvocationContext):{width:number;big:boolean}|undefined {
  const points=stringMember(state,"encoding",meter);
  let bytes:Iterable<number>;
  try{bytes=context.codecs===undefined?encodeUtf8(points,"strict",meter):context.codecs.unicodeUtf8(state.member("encoding",meter)!,context);}
  catch(error){
    // The native UTF-8 conversion raises against the actual encoding field,
    // including str subtypes, rather than a fresh string made from its payload.
    if(error instanceof PythonEncodeError&&context.prepareException!==undefined)throw context.prepareException(error,{unicodeObject:state.member("encoding",meter)!});
    throw error;
  }
  let name="";
  for(const byte of bytes){meter.checkpoint(1,2);if(byte===0)break;name+=String.fromCharCode(byte);}
  if(name==="cp65001")return {width:3,big:false};
  let lowered="";
  for(const char of name){meter.checkpoint(1,2);const point=char.codePointAt(0)!;lowered+=String.fromCodePoint(point>=65&&point<=90?point+32:point);}
  if(!lowered.startsWith("utf"))return undefined;
  let tail=lowered.slice(3);
  if(tail[0]==="-"||tail[0]==="_")tail=tail.slice(1);
  if(tail==="8")return {width:3,big:false};
  const prefix=tail.slice(0,2);
  if(prefix!=="16"&&prefix!=="32")return undefined;
  tail=tail.slice(2);
  if(tail==="")return {width:Number(prefix)/8,big:false};
  if(tail[0]==="-"||tail[0]==="_")tail=tail.slice(1);
  return tail==="be"||tail==="le"?{width:Number(prefix)/8,big:tail==="be"}:undefined;
}

function invokeHandler(name:StandardCodecError,error:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,context:BuiltinInvocationContext):RuntimeValue {
  const state=runtimeExceptionPayload(error);
  const raised=state!==undefined&&error.kind==="instance"?new RuntimeRaisedException(error,meter):undefined;
  if(name==="strict"){
    if(raised===undefined){
      meter.checkpoint(0,192);
      throw new PythonRuntimeError("TypeError","codec must pass exception instance");
    }
    throw raised;
  }
  if(context.isException===undefined)throw Error("codec error handlers require native exception inheritance");
  let mode:"encode"|"decode"|"translate"|undefined;
  if(raised!==undefined)for(const [candidate,exception] of [["encode","UnicodeEncodeError"],["decode","UnicodeDecodeError"],["translate","UnicodeTranslateError"]] as const){
    const matches=context.isException(raised,exception);
    // Classification can cross an explicit service boundary. Do not classify
    // another family or enter recovery after that service cancels execution.
    meter.checkpoint();
    if(matches){mode=candidate;break;}
  }
  if(mode===undefined||((name==="namereplace"||name==="xmlcharrefreplace")&&mode!=="encode")||((name==="surrogateescape"||name==="surrogatepass")&&mode==="translate")){
    const actual=hasRuntimeInstanceAttributes(error)?error.type:error.kind==="type"?error.metaclass:undefined;
    const primitiveName=error.kind==="none"?"NoneType":error.kind==="not-implemented"?"NotImplementedType":error.kind==="iterator"?error.typeName??"iterator":error.kind;
    const type=actual===undefined?values.string(primitiveName).value:runtimeQualifiedTypeNamePoints(actual,values,meter);
    const message=values.string("don't know how to handle ").value.concat(type,meter).concat(values.string(" in error callback").value,meter);
    throw new PythonUnicodeMessageError("TypeError",message,meter);
  }
  const encoding=name==="surrogatepass"?surrogateEncoding(state!,meter,context):undefined;
  if(name==="surrogatepass"&&encoding===undefined)throw raised;
  const range=errorRange(state!,mode==="decode",meter);
  const result=(replacement:RuntimeValue,position=range.end)=>values.tuple([replacement,values.integer(position)]);
  if(name==="ignore")return result(values.string(""));
  if(name==="replace"){
    const count=mode==="decode"?1:range.count;
    meter.checkpoint(count,count*2);
    // PyUnicode_New does not canonicalize a nonempty replacement, even '?'.
    return result(values.string((mode==="encode"?"?":"\ufffd").repeat(count),"fresh"));
  }
  if(name==="surrogatepass"||name==="surrogateescape"){
    if(mode==="decode"){
      if(name==="surrogateescape"){
        let replacement="",consumed=0;
        while(consumed<4&&consumed<range.count){
          const byte=range.point(range.start+consumed);
          if(byte<128)break;
          meter.checkpoint(1,2);replacement+=String.fromCodePoint(0xdc00+byte);consumed++;
        }
        if(consumed===0)throw raised;
        return result(values.string(replacement),range.start+consumed);
      }
      const {width,big}=encoding!;
      if(range.length-range.start<width)throw raised;
      let point=0;
      if(width===3){
        const a=range.point(range.start),b=range.point(range.start+1),c=range.point(range.start+2);
        if((a&0xf0)!==0xe0||(b&0xc0)!==0x80||(c&0xc0)!==0x80)throw raised;
        point=((a&15)<<12)|((b&63)<<6)|(c&63);
      }else for(let index=0;index<width;index++)point=point*256+range.point(range.start+(big?index:width-index-1));
      if(point<0xd800||point>0xdfff)throw raised;
      return result(values.string(String.fromCodePoint(point)),range.start+width);
    }
    const width=encoding?.width??1;
    // The temporary buffer exists even if a later character rejects recovery.
    // Admit its metadata and payload before allocation or guest re-raising.
    meter.checkpoint(1,64+range.count*width);
    const bytes=new Uint8Array(range.count*width);
    let offset=0;
    for(let index=range.start;index<range.end;index++){
      const point=range.point(index);
      if(name==="surrogateescape"){
        if(point<0xdc80||point>0xdcff)throw raised;
        bytes[offset++]=point-0xdc00;
      }else{
        if(point<0xd800||point>0xdfff)throw raised;
        if(width===3){bytes[offset++]=0xe0|(point>>12);bytes[offset++]=0x80|((point>>6)&63);bytes[offset++]=0x80|(point&63);}
        else for(let byte=0;byte<width;byte++)bytes[offset++]=(point>>>((encoding!.big?width-byte-1:byte)*8))&255;
      }
    }
    // PyBytes_FromStringAndSize(NULL, n) retains only the empty singleton.
    return result(values.bytes(bytes,bytes.length===0?"canonical":"fresh"));
  }
  let replacement="";
  for(let index=range.start;index<range.end;index++){
    const point=range.point(index);
    // Unicode scalars have a bounded spelling; charge before host formatting.
    meter.checkpoint(1,32);
    let part:string;
    if(name==="xmlcharrefreplace")part=`&#${point};`;
    else {
      const canonical=name==="namereplace"?unicodeCodecName(point,meter):undefined;
      if(canonical!==undefined)part=`\\N{${canonical}}`;
      else part=`\\${point<=255?"x":point<=65535?"u":"U"}${point.toString(16).padStart(point<=255?2:point<=65535?4:8,"0")}`;
    }
    meter.checkpoint(1,part.length*2);replacement+=part;
  }
  return result(values.string(replacement),name==="namereplace"?Math.max(range.start,range.end):range.end);
}

/** New callable objects for each interpreter, shared by name only inside that
 * interpreter. Registrations may replace them; unregistration protects names. */
export function createStandardCodecErrors(values:RuntimeValues,meter:ExecutionMeter):Map<string,RuntimeValue>{
  const result=new Map<string,RuntimeValue>();
  for(const name of Object.keys(standardCodecErrorDocumentation) as StandardCodecError[]){
    meter.checkpoint(1,96);
    const functionName=name.startsWith("surrogate")?name:`${name}_errors`;
    result.set(name,values.builtinFunction({name:functionName,doc:standardCodecErrorDocumentation[name],module:null,textSignature:"($self, object, /)",invoke(args,keywords,meter,context){
      let fatal=false;
      try{
        meter.checkpoint();
        // Invalid calls allocate diagnostics too. Admit them before construction,
        // so exhausted storage remains fatal rather than a catchable TypeError.
        if(keywords.items.size!==0){
          meter.checkpoint(0,192+2*functionName.length);
          throw new PythonRuntimeError("TypeError",`${functionName}() takes no keyword arguments`);
        }
        if(args.length!==1){
          meter.checkpoint(0,256+2*functionName.length);
          throw new PythonRuntimeError("TypeError",`${functionName}() takes exactly one argument (${args.length} given)`);
        }
        if(context===undefined)throw Error("codec error handlers require an invocation context");
        try{return invokeHandler(name,args[0],values,meter,context);}
        catch(error){
          if(error instanceof ExecutionLimitError)throw error;
          meter.checkpoint();
          if(!(error instanceof RuntimeRaisedException))throw error;
          // PyCodec_StrictErrors performs a new native raise, including when a
          // surrogate handler declines recovery. Do not treat it as propagation.
          if(context.chainException===undefined)throw Error("codec error handlers require interpreter exception chaining");
          throw context.chainException(error.value);
        }
      }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }}));
  }
  return result;
}
