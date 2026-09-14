import {expect,it} from "vitest";
import referenceCases from "./__snapshots__/codec-errors-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {ExecutionBudget} from "./execution-budget.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {RuntimeExceptionState,runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:8000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,v,meter).value};
  const types=new RuntimeTypeRegistry(v,keys,meter),exceptions=new RuntimeExceptionExecution(types,v,meter),registry=new RuntimeCodecRegistry(v,meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const context:BuiltinInvocationContext={call(fn,args){if(fn.kind!=="builtin_function_or_method")throw Error("expected native callback");return fn.value.invoke(args,keywords,meter,context);},chainException:exceptions.chain.bind(exceptions),isCallable:fn=>fn.kind==="builtin_function_or_method",isStopIteration:()=>false,isException:(error,name)=>exceptions.matches(error,name as Parameters<typeof exceptions.matches>[1]),typeName:value=>types.nativeType(value)?.value.name??value.kind};
  const error=(mode:"encode"|"decode"|"translate",object:RuntimeValue,start=0,end=1,encoding="ascii")=>{
    const value=v.instance(types.exceptionType(mode==="encode"?"UnicodeEncodeError":mode==="decode"?"UnicodeDecodeError":"UnicodeTranslateError"),undefined,new RuntimeExceptionState(v.tuple([]),meter));
    const state=runtimeExceptionPayload(value)!;
    state.assignMember("object",object,meter);state.assignMember("start",v.integer(start),meter);state.assignMember("end",v.integer(end),meter);state.assignMember("encoding",v.string(encoding),meter);
    return value;
  };
  const invoke=(name:string,arg:RuntimeValue)=>context.call(registry.lookupError(name),[arg]);
  return {v,meter,registry,context,types,error,invoke};
}

it("initializes all eight handlers per interpreter and keeps replaced builtins protected from unregistration",()=>{
  const a=fixture(),b=fixture();
  for(const name of ["strict","ignore","replace","xmlcharrefreplace","backslashreplace","namereplace","surrogateescape","surrogatepass"]){
    expect(a.registry.lookupError(name)).toBe(a.registry.lookupError(name));
    expect(a.registry.lookupError(name)).not.toBe(b.registry.lookupError(name));
    expect(()=>a.registry.unregisterError(name)).toThrow(`cannot un-register built-in error handler '${name}'`);
  }
  a.registry.registerError("strict",a.registry.lookupError("ignore"),a.context);
  expect(()=>a.registry.unregisterError("strict")).toThrow("cannot un-register built-in error handler 'strict'");
  expect(a.registry.unregisterError("absent")).toBe(false);
  a.registry.registerError("custom",a.registry.lookupError("ignore"),a.context);
  expect(a.registry.unregisterError("custom")).toBe(true);
  expect(a.registry.unregisterError("custom")).toBe(false);
});

it.each([
  ["ignore","encode","",1], ["ignore","decode","",1], ["ignore","translate","",1],
  ["replace","encode","?",1], ["replace","decode","\ufffd",1], ["replace","translate","\ufffd",1],
  ["backslashreplace","encode","\\xe9",1], ["backslashreplace","decode","\\xff",1], ["backslashreplace","translate","\\xe9",1],
  ["xmlcharrefreplace","encode","&#233;",1], ["namereplace","encode","\\N{LATIN SMALL LETTER E WITH ACUTE}",1],
  ["surrogateescape","decode","\udcff",1]
] as const)("%s handles native Unicode %s errors",(handler,mode,replacement,position)=>{
  const {v,error,invoke}=fixture();
  expect(invoke(handler,error(mode,mode==="decode"?v.bytes(new Uint8Array([255])):v.string("é")))).toEqual(v.tuple([v.string(replacement),v.integer(position)]));
});

it("strict raises the original exception, and rejects non-exceptions",()=>{
  const {v,meter,invoke,types}=fixture(),original=v.instance(types.exceptionType("ValueError"),undefined,new RuntimeExceptionState(v.tuple([v.string("sentinel")]),meter));
  try{invoke("strict",original);expect.fail("expected error");}catch(error){expect(error).toBeInstanceOf(RuntimeRaisedException);expect((error as RuntimeRaisedException).value).toBe(original);}
  expect(()=>invoke("strict",v.none)).toThrow("codec must pass exception instance");
});

it.each(["ignore","replace","backslashreplace","xmlcharrefreplace","namereplace","surrogateescape","surrogatepass"])("%s rejects unrelated exception types",name=>{
  const {v,meter,invoke,types}=fixture();
  expect(()=>invoke(name,v.instance(types.exceptionType("ValueError"),undefined,new RuntimeExceptionState(v.tuple([]),meter)))).toThrow("don't know how to handle ValueError in error callback");
  expect(()=>invoke(name,v.none)).toThrow("don't know how to handle NoneType in error callback");
});

it.each([[-9,-3,"?",1],[7,9,"?",3],[2,1,"",1],[0,9,"???",3]] as const)("clips Unicode error range %i:%i without mutating attributes",(start,end,replacement,position)=>{
  const {v,meter,error,invoke}=fixture(),e=error("encode",v.string("abc"),start,end),state=runtimeExceptionPayload(e)!;
  expect(invoke("replace",e)).toEqual(v.tuple([v.string(replacement),v.integer(position)]));
  expect(state.member("start",meter)).toEqual(v.integer(start));expect(state.member("end",meter)).toEqual(v.integer(end));
});

it("reads native fields after mutation and rejects missing or wrong object fields",()=>{
  const {v,meter,error,invoke}=fixture(),e=error("encode",v.string("abc"),0,3),state=runtimeExceptionPayload(e)!;
  state.assignMember("object",v.string("é"),meter);
  expect(invoke("replace",e)).toEqual(v.tuple([v.string("?"),v.integer(1)]));
  state.assignMember("object",v.none,meter);
  expect(()=>invoke("ignore",e)).toThrow("UnicodeError 'object' attribute must be a string");
  state.assignMember("object",undefined,meter);
  expect(()=>invoke("replace",e)).toThrow("UnicodeError 'object' attribute is not set");
});

it("surrogateescape bounds decode runs to four bytes and stops at ASCII",()=>{
  const {v,error,invoke}=fixture();
  for(const [bytes,expected,position] of [[[255,254,253,252,251],"\udcff\udcfe\udcfd\udcfc",4],[[255,65,254],"\udcff",1]] as const){
    expect(invoke("surrogateescape",error("decode",v.bytes(Uint8Array.from(bytes)),0,bytes.length))).toEqual(v.tuple([v.string(expected),v.integer(position)]));
  }
  expect(invoke("surrogateescape",error("encode",v.string("\udc80\udcff"),0,2))).toEqual(v.tuple([v.bytes(new Uint8Array([128,255])),v.integer(2)]));
});

it.each([
  ["utf-8",[237,160,128]], ["UTF_8",[237,160,128]], ["cp65001",[237,160,128]],
  ["utf16",[0,216]], ["utf_16_be",[216,0]], ["utf-32",[0,216,0,0]], ["UTF32BE",[0,0,216,0]]
] as const)("surrogatepass recognizes its exact encoding spelling %s",(encoding,bytes)=>{
  const {v,error,invoke}=fixture();
  expect(invoke("surrogatepass",error("encode",v.string("\ud800"),0,1,encoding))).toEqual(v.tuple([v.bytes(Uint8Array.from(bytes)),v.integer(1)]));
  expect(invoke("surrogatepass",error("decode",v.bytes(Uint8Array.from(bytes)),0,1,encoding))).toEqual(v.tuple([v.string("\ud800"),v.integer(bytes.length)]));
});

it.each(["CP65001","utf 8","u8","utf--8","utf-8-sig"])("surrogatepass does not use registry normalization for %s",encoding=>{
  const {v,error,invoke}=fixture(),original=error("encode",v.string("\ud800"),0,1,encoding);
  try{invoke("surrogatepass",original);expect.fail("expected original error");}catch(error){expect(error).toBeInstanceOf(RuntimeRaisedException);expect((error as RuntimeRaisedException).value).toBe(original);}
});

it("resumes decoding against the callback's replacement object but encoding against the original length",()=>{
  const {v,meter,registry,context,error}=fixture(),replacement=v.bytes(new Uint8Array([120,121,122,123]));
  const callback=v.builtinFunction({name:"mutate",invoke(args){runtimeExceptionPayload(args[0])!.assignMember("object",replacement,meter);return v.tuple([v.string("?"),v.integer(-1)]);}});
  registry.registerError("mutate",callback,context);
  expect(registry.handleError("mutate",error("decode",v.bytes(new Uint8Array([255,65]))),"decode",2,context)).toEqual({replacement:v.string("?"),position:3,object:replacement});
  expect(registry.handleError("mutate",error("encode",v.string("éA")),"encode",2,context)).toEqual({replacement:v.string("?"),position:1});
});

it("validates callback tuple and index before rereading the native decode object",()=>{
  const {v,meter,registry,context,error}=fixture(),e=error("decode",v.bytes(new Uint8Array([255]))),state=runtimeExceptionPayload(e)!;
  let position:RuntimeValue=v.float(1),replacement:RuntimeValue=v.string("?");
  registry.registerError("mutate",v.builtinFunction({name:"mutate",invoke(){state.assignMember("object",v.none,meter);return v.tuple([replacement,position]);}}),context);
  expect(()=>registry.handleError("mutate",e,"decode",1,context)).toThrow("'float' object cannot be interpreted as an integer");
  position=v.integer(1);
  expect(()=>registry.handleError("mutate",e,"decode",1,context)).toThrow("UnicodeError 'object' attribute must be a bytes");
  replacement=v.none;
  expect(()=>registry.handleError("mutate",e,"decode",1,context)).toThrow("decoding error handler must return (str, int) tuple");
});

it("namereplace resumes at the clipped start for an inverted range",()=>{
  const {v,error,invoke}=fixture();
  expect(invoke("namereplace",error("encode",v.string("abc"),2,1))).toEqual(v.tuple([v.string(""),v.integer(2)]));
  expect(invoke("backslashreplace",error("encode",v.string("abc"),2,1))).toEqual(v.tuple([v.string(""),v.integer(1)]));
});

it("surrogatepass validates native encoding metadata before object metadata and preserves C-string spellings",()=>{
  const {v,meter,error,invoke}=fixture(),e=error("encode",v.string("\ud800"),0,1,"utf-8\0suffix"),state=runtimeExceptionPayload(e)!;
  expect(invoke("surrogatepass",e)).toEqual(v.tuple([v.bytes(new Uint8Array([237,160,128])),v.integer(1)]));
  state.assignMember("object",v.none,meter);
  state.assignMember("encoding",undefined,meter);
  expect(()=>invoke("surrogatepass",e)).toThrow("UnicodeError 'encoding' attribute is not set");
  state.assignMember("encoding",v.none,meter);
  expect(()=>invoke("surrogatepass",e)).toThrow("UnicodeError 'encoding' attribute must be a string");
  state.assignMember("encoding",v.string("unknown"),meter);
  try{invoke("surrogatepass",e);expect.fail("expected original error");}catch(error){expect(error).toBeInstanceOf(RuntimeRaisedException);expect((error as RuntimeRaisedException).value).toBe(e);}
});

it.each(["encode","decode","translate"] as const)("handles empty %s objects using each native handler's range contract",mode=>{
  const {v,error,invoke}=fixture(),e=error(mode,mode==="decode"?v.bytes(new Uint8Array()):v.string(""),-20,99,"utf-8");
  expect(invoke("ignore",e)).toEqual(v.tuple([v.string(""),v.integer(0)]));
  expect(invoke("replace",e)).toEqual(v.tuple([v.string(mode==="decode"?"\ufffd":""),v.integer(0)]));
  expect(invoke("backslashreplace",e)).toEqual(v.tuple([v.string(""),v.integer(0)]));
});

it("uses pinned Unicode canonical names and escapes unnamed and surrogate code points",()=>{
  const {v,error,invoke}=fixture();
  expect(invoke("namereplace",error("encode",v.string("\uac00\u4e00\u0378\ud800"),0,4))).toEqual(v.tuple([v.string("\\N{HANGUL SYLLABLE GA}\\N{CJK UNIFIED IDEOGRAPH-4E00}\\u0378\\ud800"),v.integer(4)]));
});


/** Reference-only snapshot generated outside the interpreter with CPython
 * 3.14.7 / Unicode 16.0.0 on darwin. Code points stay separate, including
 * adjacent surrogates; neither runtime nor tests delegate codecs to Python. */
it("matches all 804 pinned standard-handler reference cases",()=>{
  const {v,meter,error,invoke}=fixture();
  for(const row of referenceCases){
    const source=row.mode==="decode"?v.bytes(Uint8Array.from(row.object)):v.stringPoints(new CodePointString(Uint32Array.from(row.object),meter));
    const e=error(row.mode as "encode"|"decode"|"translate",source,row.start,row.end,row.encoding);
    if("mutation" in row){
      const object=row.mutation==="missing"?undefined:row.mutation==="none"?v.none:row.mutation==="int"?v.integer(1):row.mode==="decode"?v.string("wrong"):v.bytes(new Uint8Array([119,114,111,110,103]));
      runtimeExceptionPayload(e)!.assignMember("object",object,meter);
    }
    let actual:unknown;
    try{
      const result=invoke(row.handler,e);
      if(result.kind!=="tuple"||result.items.length!==2)throw Error("expected a handler result tuple");
      const [replacement,position]=result.items;
      if((replacement.kind!=="str"&&replacement.kind!=="bytes")||position.kind!=="int")throw Error("invalid handler result payload");
      actual={replacement:[...replacement.value],kind:replacement.kind,position:Number(position.value)};
    }catch(failure){
      if(failure instanceof RuntimeRaisedException)actual={error:failure.value.type.value.name,same:failure.value===e};
      else if(failure instanceof PythonRuntimeError)actual={error:failure.name,same:false,message:failure.message};
      else throw failure;
    }
    expect(actual,JSON.stringify(row)).toEqual(row.expected);
  }
});
