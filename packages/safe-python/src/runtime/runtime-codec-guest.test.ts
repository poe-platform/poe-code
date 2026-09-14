import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {runtimeHash} from "./runtime-hash.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {createRuntimeStringEncodeMethod} from "./runtime-string-encode-method.js";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
import {constructRuntimeBytes} from "./runtime-bytes-construction.js";
import {constructRuntimeString} from "./runtime-string-construction.js";
import {createRuntimeBytesDecodeMethod} from "./runtime-bytes-decode-method.js";
import {createRuntimeUtf8Encoder} from "./runtime-utf8-encoding.js";
import {createRuntimeUtf8Decoder} from "./runtime-utf8-decoding.js";
import {createBuildClassBuiltin} from "./builtin-build-class.js";

/** This fixture exposes test entry points, not substitute guest codec modules.
 * Search functions, codecs, error callbacks and exception handling run as compiled
 * guest functions through the real interpreter call/exception machinery. */
function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal}),values=new RuntimeValues(meter);
  const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>(),builtins=new Map<string,RuntimeValue>();
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter);
  globals.set("__name__",values.string("__main__"));
  builtins.set("__build_class__",createBuildClassBuiltin({registry:types,keys},values,meter));
  builtins.set("str",types.stringType());
  builtins.set("bytes",types.bytesType());
  const registry=new RuntimeCodecRegistry(values,meter);
  const unavailable=():never=>{throw Error("unexpected missing test capability");};
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:value=>{if(value.kind!=="str")return unavailable();return String.fromCodePoint(...value.value);},
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  for(const name of ["ValueError","TypeError","LookupError","IndexError","AssertionError","AttributeError"] as const)builtins.set(name,types.exceptionType(name));
  builtins.set("register",values.builtinFunction({name:"register",invoke:(args,_kw,_meter,invocation)=>{registry.register(args[0],invocation!);return values.none;}}));
  builtins.set("unregister",values.builtinFunction({name:"unregister",invoke:args=>{registry.unregister(args[0]);return values.none;}}));
  builtins.set("lookup",values.builtinFunction({name:"lookup",invoke:(_args,_kw,_meter,invocation)=>registry.lookup("CUSTOM",invocation!)}));
  for(const operation of ["encode","decode"] as const)builtins.set(operation,values.builtinFunction({name:operation,invoke:(args,_kw,_meter,invocation)=>registry.transform(operation,args[0],"custom",undefined,invocation!)}));
  builtins.set("register_error",values.builtinFunction({name:"register_error",invoke:(args,_kw,_meter,invocation)=>{registry.registerError("custom",args[0],invocation!);return values.none;}}));
  builtins.set("handle_error",values.builtinFunction({name:"handle_error",invoke:(args,_kw,_meter,invocation)=>{
    const result=registry.handleError("custom",args[0],"decode",3,invocation!);return values.tuple([result.replacement,values.integer(result.position)]);
  }}));
  return {values,builtins,globals,registry,run:(source:string)=>executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter)};
}

it("dispatches compiled guest codecs with cache identity, callback mutation and unchecked consumed count",()=>{
  const state=fixture();
  state.run(`
events = []
result = []
def codec(value):
    events.append(value)
    return (result, [])
info = (codec, codec, None, None)
def search(name):
    events.append(name)
    return info
register(search)
assert lookup() is info
assert lookup() is info
assert encode('input') is result
assert decode(b'input') is result
assert events == ['custom', 'input', b'input']
unregister(search)
try:
    lookup()
except LookupError:
    pass
else:
    assert False
`);
});

it("preserves guest callback exception identity and notes through the interpreter",()=>{
  fixture().run(`
failure = ValueError('guest failure')
def codec(value):
    raise failure
def search(name):
    return (codec, codec, None, None)
register(search)
try:
    encode('input')
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["encoding with 'custom' codec failed"]
else:
    assert False
try:
    decode(b'input')
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["encoding with 'custom' codec failed", "decoding with 'custom' codec failed"]
else:
    assert False
`);
});

it("invokes compiled custom error handlers and preserves replacement identity and negative positions",()=>{
  fixture().run(`
replacement = 'fixed'
failure = ValueError('token')
def handler(error):
    assert error is failure
    return (replacement, -1)
register_error(handler)
result = handle_error(failure)
assert result[0] is replacement
assert result[1] == 2
def bad_handler(error):
    return (replacement, -4)
register_error(bad_handler)
try:
    handle_error(failure)
except IndexError:
    pass
else:
    assert False
`);
});

it("exposes byte-bounded missing-handler LookupError arguments to compiled guest code",()=>{
  const state=fixture();
  state.builtins.set("lookup_missing_error",state.values.builtinFunction({name:"lookup_missing_error",invoke:()=>state.registry.lookupError("é".repeat(199)+"💥")}));
  state.run(`
try:
    lookup_missing_error()
except LookupError as error:
    assert error.args == ("unknown error handler name '" + 'é' * 199 + "'",)
else:
    assert False
`);
});

it("does not let guest exception handling suppress cancellation during a codec",()=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def codec(value):
    cancel()
    return ('', 0)
def search(name):
    return (codec, codec, None, None)
register(search)
try:
    encode('input')
except:
    recovered = True
`)).toThrow(ExecutionLimitError);
  expect(state.globals.has("recovered")).toBe(false);
});

it.each([false,true].flatMap(sourceSubtype=>[false,true].map(resultSubtype=>({sourceSubtype,resultSubtype}))))("retains registered encoder input and output identity (source subtype=$sourceSubtype, result subtype=$resultSubtype)",({sourceSubtype,resultSubtype})=>{
  const state=fixture(),{values,registry,builtins}=state;
  const encode=createRuntimeUtf8Encoder(values,(source,encoding,errors,_meter,context)=>registry.transform("encode",source,encoding,errors,context!,true));
  builtins.set("make_bytes",values.builtinFunction({name:"make_bytes",invoke:(args,keywords,meter,context)=>constructRuntimeBytes(args,keywords,values,meter,encode,context)}));
  builtins.set("text_encode",values.builtinFunction({name:"text_encode",invoke:(args,keywords,meter,context)=>createRuntimeStringEncodeMethod(args[0],values,meter,encode).value.invoke(args.slice(1),keywords,meter,context)}));
  state.run(`
class Source(str):
    def __str__(self):
        raise AssertionError('unexpected coercion')
class Result(bytes):
    pass
source = ${sourceSubtype?"Source('retained codec input')":"'retained codec input'"}
result = ${resultSubtype?"Result(b'retained codec output')":"b'retained codec output'"}
events = []
def encoder(value, *args):
    assert value is source
    events.append(args)
    return (result, None)
def search(name):
    return (encoder, None, None, None)
register(search)
assert make_bytes(source, 'custom') is result
assert make_bytes(source, 'custom', 'strict') is result
assert text_encode(source, 'custom') is result
assert text_encode(source, 'custom', 'ignore') is result
assert events == [(), ('strict',), (), ('ignore',)]
failure = ValueError('encoder failure')
def encoder(value, *args):
    assert value is source
    raise failure
unregister(search)
register(search)
try:
    make_bytes(source, 'custom')
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["encoding with 'custom' codec failed"]
else:
    assert False
`);
});

it("preserves omitted error policies through text consumers and compiled guest codecs",()=>{
  const state=fixture(),{values,registry,builtins}=state,{meter}=registry;
  const encode=createRuntimeUtf8Encoder(values,(text,encoding,errors,_meter,context)=>registry.transform("encode",text,encoding,errors,context!,true));
  const decode=createRuntimeUtf8Decoder(values,(bytes,encoding,errors,_meter,context)=>registry.transform("decode",values.bytes(bytes),encoding,errors,context!,true));
  builtins.set("make_bytes",values.builtinFunction({name:"make_bytes",invoke:(args,keywords,meter,context)=>constructRuntimeBytes(args,keywords,values,meter,encode,context)}));
  builtins.set("make_str",values.builtinFunction({name:"make_str",invoke:(args,keywords,meter,context)=>constructRuntimeString(args,keywords,values,meter,{decode:createRuntimeStringDecoder(decode,values),invocation:context})}));
  builtins.set("text_encode",createRuntimeStringEncodeMethod(values.string("x"),values,meter,encode));
  builtins.set("text_decode",createRuntimeBytesDecodeMethod(values.bytes(Uint8Array.of(120)),values,meter,decode));
  state.run(`
events = []
def encoder(value, *args):
    events.append(('encode', args))
    return (b'x', 1)
def decoder(value, *args):
    events.append(('decode', args))
    return ('x', 1)
def search(name):
    return (encoder, decoder, None, None)
register(search)
assert make_bytes('x', 'custom') == b'x'
assert make_bytes('x', 'custom', 'strict') == b'x'
assert make_bytes(source='x', encoding='custom', errors='ignore') == b'x'
assert text_encode('custom') == b'x'
assert text_encode('custom', 'strict') == b'x'
assert text_encode(encoding='custom', errors='ignore') == b'x'
assert make_str(b'x', 'custom') == 'x'
assert make_str(b'x', 'custom', 'strict') == 'x'
assert make_str(object=b'x', encoding='custom', errors='ignore') == 'x'
assert text_decode('custom') == 'x'
assert text_decode('custom', 'strict') == 'x'
assert text_decode(encoding='custom', errors='ignore') == 'x'
assert events == [('encode', ()), ('encode', ('strict',)), ('encode', ('ignore',)), ('encode', ()), ('encode', ('strict',)), ('encode', ('ignore',)), ('decode', ()), ('decode', ('strict',)), ('decode', ('ignore',)), ('decode', ()), ('decode', ('strict',)), ('decode', ('ignore',))]
`);
});

it("raises catchable consumer TypeErrors after real registry dispatch without codec failure notes",()=>{
  const state=fixture(),{values,registry,builtins}=state,{meter}=registry;
  builtins.set("text_encode",createRuntimeStringEncodeMethod(values.string("x"),values,meter,(text,encoding,errors,_meter,context)=>registry.transform("encode",text,encoding,errors,context!,true)));
  const decode=createRuntimeStringDecoder((bytes,encoding,errors,_meter,context)=>registry.transform("decode",values.bytes(bytes.toUint8Array(meter)),encoding,errors,context!,true),values);
  builtins.set("text_decode",values.builtinFunction({name:"text_decode",invoke:(_args,_kw,_meter,context)=>decode(values.bytes(new Uint8Array([120])),"custom","strict",meter,context)}));
  state.run(`
events = []
def codec(value, errors='strict'):
    events.append(errors)
    return (None, [])
def search(name):
    events.append(name)
    return (codec, codec, None, None)
register(search)
try:
    text_encode('custom')
except TypeError as error:
    assert error.args == ("'custom' encoder returned 'NoneType' instead of 'bytes'; use codecs.encode() to encode to arbitrary types",)
    assert error.__context__ is None
    assert error.__cause__ is None
    try:
        error.__notes__
    except AttributeError:
        pass
    else:
        assert False
else:
    assert False
try:
    text_decode()
except TypeError as error:
    assert error.args == ("'custom' decoder returned 'NoneType' instead of 'str'; use codecs.decode() to decode to arbitrary types",)
    assert error.__context__ is None
    assert error.__cause__ is None
else:
    assert False
assert events == ['custom', 'strict', 'strict']
`);
});
