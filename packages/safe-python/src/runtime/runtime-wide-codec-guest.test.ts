import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";
import {decodeWideUnicode,encodeWideUnicode,type UnicodeByteOrder} from "./utf-wide.js";
import {WideUnicodeDecoder,WideUnicodeEncoder} from "./utf-wide-incremental.js";
import {decodeUtf7,encodeUtf7,Utf7Decoder} from "./utf7.js";
import {decodeUtf8} from "./utf8-decode.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {decodeUtf8Signature,Utf8SignatureDecoder,Utf8SignatureEncoder} from "./utf8-signature.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";

/** Real guest calls and exception storage. Bindings expose internal operations;
 * this fixture does not claim public codecs-module import compatibility. */
function fixture(signal?:AbortSignal,byteorder:UnicodeByteOrder=-1){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:8000000,signal}),values=new RuntimeValues(meter);
  const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>();
  globals.set("__name__",values.string("__main__"));
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter),registry=new RuntimeCodecRegistry(values,meter);
  const unavailable=():never=>{throw Error("unavailable test capability");};
  const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unavailable,lookupWrite:unavailable,flush:unavailable}});
  for(const name of ["ValueError","TypeError","LookupError","IndexError","AssertionError","UnicodeEncodeError","UnicodeDecodeError","OverflowError"] as const)builtins.set(name,types.exceptionType(name));
  for(const [name,value] of Object.entries({object:types.object,type:types.type,str:types.stringType(),tuple:types.tupleType(),int:types.integerType()}))builtins.set(name,value);
  const text=(value:RuntimeValue)=>value.kind==="str"?[...value.value].map(point=>String.fromCodePoint(point)).join(""):unavailable();
  builtins.set("register_error",values.builtinFunction({name:"register_error",invoke:(args,_kw,_meter,context)=>{registry.registerError("custom",args[0],context!);return values.none;}}));
  const charmap=new RuntimeCharmap(values,meter);
  for(const operation of ["encode","decode"] as const){
    builtins.set(`charmap_${operation}`,values.builtinFunction({name:`charmap_${operation}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0],mapping=args[1]??values.none,policy=args[2]===undefined?"strict":text(args[2]);
      const recovery=new RuntimeCodecRecovery(registry,policy,source,context!);
      if(operation==="encode"&&source.kind==="str")return values.tuple([values.bytes(charmap.encode(source.value,mapping,policy==="custom"?recovery.encode.bind(recovery):policy as Utf8EncodeErrors,context!)),values.integer(source.value.length)]);
      if(operation==="decode"&&source.kind==="bytes"){
        const result=charmap.decode(source.value.toUint8Array(meter),mapping,policy==="custom"?recovery.decode.bind(recovery):policy as Utf8EncodeErrors,context!);
        return values.tuple([values.stringPoints(result.text),values.integer(result.consumed)]);
      }
      return unavailable();
    }}));
  }
  const cp1252=new SingleByteTableCodec(singleByteTables.find(table=>table.name==="cp1252")!,meter);
  builtins.set("encode_cp1252",values.builtinFunction({name:"encode_cp1252",invoke:(args,_kw,_meter,context)=>{
    const source=args[0];if(source.kind!=="str")return unavailable();
    const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
    return values.bytes(cp1252.encode(source.value,recovery.encode.bind(recovery),meter));
  }}));
  builtins.set("decode_cp1252",values.builtinFunction({name:"decode_cp1252",invoke:(args,_kw,_meter,context)=>{
    const source=args[0];if(source.kind!=="bytes")return unavailable();
    const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
    const result=cp1252.decode(source.value.toUint8Array(meter),recovery.decode.bind(recovery),meter);
    return values.tuple([values.stringPoints(result.text),values.integer(result.consumed)]);
  }}));
  for(const encoding of ["ascii","latin-1"] as const){
    builtins.set(`encode_${encoding.replaceAll("-","_")}`,values.builtinFunction({name:`encode_${encoding}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="str")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      return values.bytes(encodeSingleByte(source.value,encoding,recovery.encode.bind(recovery),meter));
    }}));
    builtins.set(`decode_${encoding.replaceAll("-","_")}`,values.builtinFunction({name:`decode_${encoding}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="bytes")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      const decoded=decodeSingleByte(source.value.toUint8Array(meter),encoding,recovery.decode.bind(recovery),meter);
      return values.tuple([values.stringPoints(decoded.text),values.integer(decoded.consumed)]);
    }}));
  }
  const signatureEncoder=new Utf8SignatureEncoder();
  builtins.set("incremental_encode8sig",values.builtinFunction({name:"incremental_encode8sig",invoke:(args,_kw,_meter,context)=>{
    const source=args[0];if(source.kind!=="str")return unavailable();
    const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
    signatureEncoder.errors=recovery.encode.bind(recovery);
    const encoded=signatureEncoder.encode(source.value,false,meter);
    return values.tuple([values.bytes(encoded),values.integer(signatureEncoder.getstate(meter))]);
  }}));
  for(const [suffix,decode,decoder] of [["8",decodeUtf8,new Utf8IncrementalDecoder()],["8sig",decodeUtf8Signature,new Utf8SignatureDecoder()]] as const){
    builtins.set(`decode${suffix}`,values.builtinFunction({name:`decode${suffix}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="bytes")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      return values.stringPoints(decode(source.value.toUint8Array(meter),recovery.decode.bind(recovery),meter).text);
    }}));
    builtins.set(`reset_decoder${suffix}`,values.builtinFunction({name:`reset_decoder${suffix}`,invoke:()=>{decoder.reset(meter);return values.none;}}));
    builtins.set(`incremental_decode${suffix}`,values.builtinFunction({name:`incremental_decode${suffix}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="bytes")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      decoder.errors=recovery.decode.bind(recovery);
      const result=decoder.decode(source.value.toUint8Array(meter),args[1]===values.true,meter),state=decoder.getstate(meter);
      return values.tuple([values.stringPoints(result),values.bytes(state[0]),values.integer(state[1])]);
    }}));
  }
  const utf7Decoder=new Utf7Decoder();
  builtins.set("decode7",values.builtinFunction({name:"decode7",invoke:(args,_kw,_meter,context)=>{
    const source=args[0];if(source.kind!=="bytes")return unavailable();
    const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
    return values.stringPoints(decodeUtf7(source.value.toUint8Array(meter),recovery.decode.bind(recovery),meter).text);
  }}));
  builtins.set("encode7",values.builtinFunction({name:"encode7",invoke:args=>{
    const source=args[0];if(source.kind!=="str")return unavailable();
    return values.bytes(encodeUtf7(source.value,meter));
  }}));
  builtins.set("reset_decoder7",values.builtinFunction({name:"reset_decoder7",invoke:()=>{utf7Decoder.reset(meter);return values.none;}}));
  builtins.set("incremental_decode7",values.builtinFunction({name:"incremental_decode7",invoke:(args,_kw,_meter,context)=>{
    const source=args[0];if(source.kind!=="bytes")return unavailable();
    const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
    utf7Decoder.errors=recovery.decode.bind(recovery);
    const result=utf7Decoder.decode(source.value.toUint8Array(meter),args[1]===values.true,meter),state=utf7Decoder.getstate(meter);
    return values.tuple([values.stringPoints(result),values.bytes(state[0]),values.integer(state[1])]);
  }}));
  for(const width of [16,32] as const){
    const decoder=new WideUnicodeDecoder(width),encoder=new WideUnicodeEncoder(width);
    builtins.set(`set_decoder_state${width}`,values.builtinFunction({name:`set_decoder_state${width}`,invoke:()=>{
      decoder.setstate([new Uint8Array([81]),1n],meter);return values.none;
    }}));
    builtins.set(`reset_encoder${width}`,values.builtinFunction({name:`reset_encoder${width}`,invoke:()=>{
      encoder.reset(meter);return values.none;
    }}));
    builtins.set(`incremental_decode${width}`,values.builtinFunction({name:`incremental_decode${width}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="bytes")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      decoder.errors=recovery.decode.bind(recovery);
      const result=decoder.decode(source.value.toUint8Array(meter),true,meter),state=decoder.getstate(meter);
      return values.tuple([values.stringPoints(result),values.bytes(state[0]),values.integer(state[1])]);
    }}));
    builtins.set(`incremental_encode${width}`,values.builtinFunction({name:`incremental_encode${width}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="str")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      encoder.errors=recovery.encode.bind(recovery);
      const result=encoder.encode(source.value,false,meter);
      return values.tuple([values.bytes(result),values.integer(encoder.getstate(meter))]);
    }}));
    builtins.set(`decode${width}`,values.builtinFunction({name:`decode${width}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="bytes")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      return values.stringPoints(decodeWideUnicode(source.value.toUint8Array(meter),width,-1,recovery.decode.bind(recovery),meter).text);
    }}));
    builtins.set(`encode${width}`,values.builtinFunction({name:`encode${width}`,invoke:(args,_kw,_meter,context)=>{
      const source=args[0];if(source.kind!=="str")return unavailable();
      const recovery=new RuntimeCodecRecovery(registry,"custom",source,context!);
      return values.bytes(encodeWideUnicode(source.value,width,byteorder,recovery.encode.bind(recovery),meter));
    }}));
  }
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  return {values,builtins,run:(source:string)=>{
    try {return executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter);}
    catch(error){
      if(error instanceof RuntimeRaisedException)throw new Error(error.value.type.value.name+": "+JSON.stringify(runtimeExceptionPayload(error.value)?.args.items.map(value=>value.kind==="str"?text(value):value.kind)));
      throw error;
    }
  }};
}

it("runs UTF-8 registry callbacks with exception reuse, negative index mutation and BOM-relative objects",()=>{
  fixture().run(`
events = []
source = b'\\xffA\\xfe'
def other(error):
    raise AssertionError('handler changed within an operation')
def handler(error):
    if events:
        assert error is events[0]
        assert error.encoding == 'changed'
        assert error.start == 2 and error.end == 3
        assert error.args == ('utf-8', source, 0, 1, 'invalid start byte')
    else:
        assert error.object == source
        error.encoding = 'changed'
        register_error(other)
    events.append(error)
    return ('?', error.end)
register_error(handler)
assert decode8(source) == '?A?'
assert len(events) == 2
class Position:
    def __index__(self):
        problem.object = b'\\x00Z'
        return -1
def replacement(error):
    global problem
    problem = error
    assert error.object == b'\\xff'
    assert error.start == 0 and error.end == 1
    error.object = None
    return ('!', Position())
register_error(replacement)
assert decode8sig(b'\\xef\\xbb\\xbf\\xff') == '!Z'
def invalid(error):
    return (b'?', 1)
register_error(invalid)
try:
    decode8(b'\\xff')
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    raise AssertionError('invalid replacement accepted')
`);
});

it("retains reentrant UTF-8 BOM reset while committing the outer buffered suffix",()=>{
  fixture().run(`
def handler(error):
    reset_decoder8sig()
    error.object = b'\\x00Z\\xe2'
    return ('?', -2)
register_error(handler)
assert incremental_decode8sig(b'\\xef\\xbb\\xbf\\xff', False) == ('?Z', b'', 1)
assert incremental_decode8sig(b'\\xef\\xbb\\xbfA', True) == ('A', b'', 0)
def shortened(error):
    error.object = b''
    return ('?', 0)
register_error(shortened)
assert incremental_decode8(b'\\xffA', False) == ('?', b'\\xffA', 0)
def failure(error):
    raise ValueError('guest failure')
register_error(failure)
try:
    incremental_decode8(b'B', True)
except ValueError as error:
    assert error.args == ('guest failure',)
else:
    raise AssertionError('guest failure lost')
reset_decoder8()
assert incremental_decode8(b'A', True) == ('A', b'', 0)
`);
});

it.each([16,32] as const)("retains incremental UTF-%i state changes from real guest error handlers",width=>{
  fixture().run(`
def handler(error):
    set_decoder_state${width}()
    return ('?', error.end)
register_error(handler)
assert incremental_decode${width}(b'\\x00') == ('?', b'', 1)
assert incremental_decode${width}(${width===16?"b'\\x00A'":"b'\\x00\\x00\\x00A'"}) == ('A', b'', 1)
assert incremental_encode${width}('')[1] == 0
def encoder_handler(error):
    reset_encoder${width}()
    return ('?', error.end)
register_error(encoder_handler)
assert incremental_encode${width}('\\ud800') == (${width===16?"b'?\\x00'":"b'?\\x00\\x00\\x00'"}, 2)
assert incremental_encode${width}('A') == (${width===16?"b'\\xff\\xfeA\\x00'":"b'\\xff\\xfe\\x00\\x00A\\x00\\x00\\x00'"}, 0)
`);
});

it("retains exception and handler identity within one decode, and resolves negative positions after object mutation",()=>{
  fixture().run(`
events = []
source = b'\\x00\\xdcA\\x00\\x00\\xdc'
def new_handler(error):
    raise AssertionError('handler changed during one operation')
def handler(error):
    if events:
        assert error is events[0]
        assert error.encoding == 'changed'
        assert error.start == 4
        assert error.reason == 'illegal encoding'
        assert error.args == ('utf-16-le', source, 0, 2, 'illegal encoding')
    else:
        assert error.object == source and error.object is not source
        assert error.args[1] is error.object
        error.encoding = 'changed'
        error.reason = 'changed'
        register_error(new_handler)
    events.append(error)
    return ('?', error.end)
register_error(handler)
assert decode16(source) == '?A?'
assert len(events) == 2
def replacement(error):
    error.object = b'\\x00\\x00Z\\x00'
    return ('!', -2)
register_error(replacement)
assert decode16(b'\\x00\\xdc') == '!Z'
`);
});

it("validates guest callback return values, index mutation and encoding replacement alignment",()=>{
  fixture().run(`
class Position:
    def __index__(self):
        problem.object = b'\\x00\\x00B\\x00'
        return -2
def handler(error):
    global problem
    problem = error
    error.object = None
    return ('?', Position())
register_error(handler)
assert decode16(b'\\x00\\xdc') == '?B'
def invalid(error):
    return (b'?', 2)
register_error(invalid)
try:
    decode16(b'\\x00\\xdc')
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    assert False
try:
    encode16('\\ud800')
except IndexError as error:
    assert error.args == ('position 2 from error handler out of bounds',)
else:
    assert False
def aligned(error):
    return (b'X\\x00', -1)
register_error(aligned)
assert encode16('\\ud800A') == b'X\\x00A\\x00'
try:
    encode32('\\ud800A')
except UnicodeEncodeError as error:
    assert error.encoding == 'utf-32-le'
    assert error.start == 0 and error.end == 1
else:
    assert False
`);
});

it("propagates guest failure identity and cancellation through registry-backed kernels",()=>{
  fixture().run(`
failure = ValueError('guest failure')
def handler(error):
    raise failure
register_error(handler)
try:
    decode32(b'\\x00\\xd8\\x00\\x00')
except ValueError as error:
    assert error is failure
else:
    assert False
`);
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def handler(error):
    cancel()
    return ('?', error.end)
register_error(handler)
try:
    encode16('\\ud800')
except:
    pass
`)).toThrow(ExecutionLimitError);
});

it("reraises the cached, mutated UnicodeEncodeError when a replacement cannot be encoded",()=>{
  fixture().run(`
source = '\\ud800A'
def handler(error):
    global problem
    problem = error
    assert error.object is source
    error.encoding = 'changed'
    return (b'x', 1)
register_error(handler)
try:
    encode16(source)
except UnicodeEncodeError as error:
    assert error is problem
    assert error.encoding == 'changed'
else:
    assert False
def surrogate(error):
    global problem
    problem = error
    return ('\\ud801', 1)
register_error(surrogate)
try:
    encode32(source)
except UnicodeEncodeError as error:
    assert error is problem
else:
    assert False
`);
});

it("retains UTF-7 handler and exception identity and resumes after guest input replacement",()=>{
  fixture().run(`
source = b'+ABC-+ABC-'
events = []
def replacement_handler(error):
    raise AssertionError('changed handler within one decode')
def handler(error):
    if events:
        assert error is events[0]
        assert error.encoding == 'changed'
        assert (error.start, error.end) == (5, 10)
        assert error.reason == 'non-zero padding bits in shift sequence'
        assert error.args == ('utf7', source, 0, 5, 'non-zero padding bits in shift sequence')
    else:
        assert error.object == source and error.object is not source
        error.encoding = 'changed'
        register_error(replacement_handler)
    events.append(error)
    return ('?', error.end)
register_error(handler)
assert decode7(source) == '\\x10?\\x10?'
assert len(events) == 2
class Position:
    def __index__(self):
        problem.object = b'AZ'
        return -1
def replace_input(error):
    global problem
    problem = error
    error.object = None
    return ('!', Position())
register_error(replace_input)
assert decode7(b'+A-') == '!Z'
def restart_final(error):
    assert error.reason == 'unterminated shift sequence'
    error.object = b'Z'
    return ('?', 0)
register_error(restart_final)
assert decode7(b'+2AA') == '?Z'
assert encode7('\\ud800\\udc00+') == b'+2ADcAAAr-'
`);
});

it("clears original buffered bytes on final recovery after a guest replaces error.object",()=>{
  fixture().run(`
def shortened(error):
    error.object = b''
    return ('?', 0)
register_error(shortened)
assert incremental_decode7(b'\\xffA', False) == ('?', b'\\xffA', 0)
assert incremental_decode7(b'', True) == ('?', b'', 0)
assert incremental_decode8(b'\\xffA', False) == ('?', b'\\xffA', 0)
assert incremental_decode8(b'', True) == ('?', b'', 0)
assert incremental_decode8sig(b'\\xef\\xbb\\xbf\\xffA', False) == ('?', b'\\xffA', 0)
assert incremental_decode8sig(b'', True) == ('?', b'', 0)
assert incremental_decode16(b'\\xff\\xfe\\x00\\xdc') == ('?', b'', 0)
assert incremental_decode32(b'\\xff\\xfe\\x00\\x00\\x00\\x00\\x11\\x00') == ('?', b'', 0)
`);
});

it("keeps UTF-7 incremental input across failures and validates guest recovery results",()=>{
  fixture().run(`
failure = ValueError('guest failure')
def handler(error):
    raise failure
register_error(handler)
assert incremental_decode7(b'A+AB', False) == ('A', b'+AB', 0)
try:
    incremental_decode7(b'-', True)
except ValueError as error:
    assert error is failure
else:
    assert False
def recover(error):
    reset_decoder7()
    assert error.object == b'+ABC-'
    return ('?', -1)
register_error(recover)
assert incremental_decode7(b'C-', True) == ('\\x10?-', b'', 0)
def invalid(error):
    return (b'?', 1)
register_error(invalid)
try:
    decode7(b'\\xff')
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    assert False
def out_of_bounds(error):
    return ('?', -2)
register_error(out_of_bounds)
try:
    decode7(b'\\xff')
except IndexError as error:
    assert error.args == ('position -1 from error handler out of bounds',)
else:
    assert False
`);
});

it.each([false,true])("cancellation from guest UTF-7 recovery remains uncatchable (throws=%s)",throws=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def handler(error):
    cancel()
    ${throws?"raise ValueError('guest failure')":"return ('?', error.end)"}
register_error(handler)
try:
    decode7(b'\\xff')
except:
    pass
`)).toThrow(ExecutionLimitError);
});

it("recovers signature encoding through the shared registry with cached handler and exception identity",()=>{
  fixture().run(`
events = []
def replacement_handler(error):
    return (b'!', error.end)
def handler(error):
    events.append(error)
    register_error(replacement_handler)
    assert error.encoding == 'utf-8'
    assert error.object is source
    return (b'\\xff', error.end)
register_error(handler)
source = 'A\\ud800\\udfffB\\udc80'
assert incremental_encode8sig(source) == (b'\\xef\\xbb\\xbfA\\xffB\\xff', 0)
assert len(events) == 2
assert events[0] is events[1]
assert (events[0].start, events[0].end) == (4, 5)
assert incremental_encode8sig('\\ud800') == (b'!', 0)
`);
});

it("preserves signature encoder state and refreshes the cached fault on invalid text replacement",()=>{
  fixture().run(`
events = []
def handler(error):
    events.append(error)
    error.reason = 'changed by guest'
    error.start = 42
    error.end = 99
    error.object = 'ZZ'
    error.encoding = 'new'
    return ('é', 1)
register_error(handler)
try:
    incremental_encode8sig('\\ud800')
except UnicodeEncodeError as error:
    assert error is events[0]
    assert (error.start, error.end, error.reason) == (0, 1, 'surrogates not allowed')
    assert (error.object, error.encoding) == ('ZZ', 'new')
else:
    assert False
assert incremental_encode8sig('A') == (b'A', 0)
`);
});

it("runs single-byte registry recovery with negative positions, mutation and original exception identity",()=>{
  fixture().run(`
for encode in (encode_ascii, encode_latin_1):
    seen = []
    def handler(error):
        seen.append(error)
        error.object = 'mutated'
        error.encoding = 'changed'
        error.start = 99
        error.end = 100
        error.reason = 'changed'
        return 'Ā', -1
    register_error(handler)
    try:
        encode('ĀZ')
    except UnicodeEncodeError as error:
        assert error is seen[0]
        assert error.object == 'mutated'
        assert error.encoding == 'changed'
        assert error.start == 0 and error.end == 1
        assert error.reason in ('ordinal not in range(128)', 'ordinal not in range(256)')
    else:
        assert False
    def handler(error):
        return b'\\xff', -1
    register_error(handler)
    assert encode('ĀZ') == b'\\xffZ'

def handler(error):
    return 'é', -1
register_error(handler)
assert encode_latin_1('ĀZ') == b'\\xe9Z'

seen = []
class Index:
    def __index__(self):
        seen[0].object = b'XYZ'
        return -2

def handler(error):
    seen.append(error)
    return '?', Index()
register_error(handler)
assert decode_ascii(b'\\xffA') == ('?YZ', 2)
assert seen[0].object == b'XYZ'
assert seen[0].args == ('ascii', b'\\xffA', 0, 1, 'ordinal not in range(128)')

seen = []
def handler(error):
    seen.append(error)
    if len(seen) == 1:
        register_error(lambda error: ('WRONG', error.end))
    return '?', error.end
register_error(handler)
assert decode_ascii(b'\\xffA\\xfe') == ('?A?', 3)
assert seen[0] is seen[1]
assert decode_ascii(b'\\xff') == ('WRONG', 1)
`);
});

it.each(["encode_ascii('Ā')","encode_latin_1('Ā')","decode_ascii(b'\\xff')"])("preserves guest callback failures in %s",expression=>{
  fixture().run(`
failure = ValueError('guest callback')
def handler(error):
    raise failure
register_error(handler)
try:
    ${expression}
except ValueError as caught:
    assert caught is failure
else:
    assert False
`);
});
it.each(["encode_ascii('Ā')","encode_latin_1('Ā')","decode_ascii(b'\\xff')"])("terminates cancelled guest recovery in %s",expression=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def handler(error):
    cancel()
    return '?', error.end
register_error(handler)
${expression}
`)).toThrow(ExecutionLimitError);
});

it("routes character maps through real guest handlers and negative index resumes",()=>{
  fixture().run(String.raw`
seen = []
class Index:
    def __index__(self):
        return -1
def recover(e):
    seen.append((e.encoding, e.start, e.end, e.reason))
    return ('€', Index())
register_error(recover)
assert encode_cp1252('ĀāA') == b'\x80A'
assert seen == [('charmap', 0, 2, 'character maps to <undefined>')]
def replace_input(e):
    e.object = b'ABC'
    return ('€', -1)
register_error(replace_input)
assert decode_cp1252(b'\x81Q') == ('€C', 2)
`);
});

it("retains character-map guest exception identity and validates recovery returns",()=>{
  fixture().run(String.raw`
seen = []
def invalid_text(e):
    seen.append(e)
    e.start = 99
    e.reason = 'mutated'
    return ('Ā', e.end)
register_error(invalid_text)
try:
    encode_cp1252('ā')
except UnicodeEncodeError as e:
    assert e is seen[0]
    assert (e.start, e.end, e.reason) == (0, 1, 'character maps to <undefined>')
else:
    assert False
def invalid_position(e):
    return ('?', -99)
register_error(invalid_position)
try:
    decode_cp1252(b'\x81')
except IndexError as e:
    assert str(e) == 'position -98 from error handler out of bounds'
else:
    assert False
failure = ValueError('guest failure')
def fail(e):
    raise failure
register_error(fail)
try:
    encode_cp1252('Ā')
except ValueError as e:
    assert e is failure
else:
    assert False
`);
});

it.each(["{}", "''", "'\\ufffe' * 256"])("retains charmap decode exception args after surrogateescape recovery with %s",mapping=>{
  fixture().run(`
source = b'\\xff\\xfea'
try:
    charmap_decode(source, ${mapping}, 'surrogateescape')
except UnicodeDecodeError as error:
    assert error.args == ('charmap', source, 0, 1, 'character maps to <undefined>'), 'original decode arguments'
    assert (error.start, error.end, error.reason) == (2, 3, 'character maps to <undefined>')
    assert error.object == source
else:
    assert False
`);
});

it("executes arbitrary guest charmap lookups with Python probing and subtype semantics",()=>{
  fixture().run(String.raw`
events = []
class Mapping:
    def __getitem__(self, key):
        events.append(key)
        if key == 65:
            return None
        if key == 66:
            raise LookupError('missing')
        return b'Z' if key == 67 else key
assert charmap_encode('ABC', Mapping(), 'replace') == (b'??Z', 3)
assert events == [65, 66, 67, 63, 63, 67]
class Integer(int):
    def __int__(self):
        raise AssertionError('coercion')
    def __index__(self):
        raise AssertionError('coercion')
class Text(str):
    def __str__(self):
        raise AssertionError('coercion')
assert charmap_decode(b'ABCD', {65: Integer(128512), 66: Text('XY'), 67: '', 68: '\ud800'}) == ('😀XY\ud800', 4)
assert charmap_encode('AB', {65: Integer(255), 66: b'XYZ'}) == (b'\xffXYZ', 2)
class Table(str):
    def __getitem__(self, key):
        return 'override'
assert charmap_decode(b'\x00', Table('Q')) == ('override', 1)
assert charmap_decode(b'\x00', 'Q') == ('Q', 1)
assert charmap_encode('', 123) == (b'', 0)
assert charmap_decode(b'', 123) == ('', 0)
`);
});

it("shares real registry charmap recovery, mutated inputs, index resumes and guest failures",()=>{
  fixture().run(String.raw`
events = []
class Mapping:
    def __getitem__(self, key):
        events.append(key)
        if key == 65:
            return None
        return key
class Position:
    def __index__(self):
        failure.object = b'XYZ'
        return -1
failure = None
def handler(error):
    global failure
    failure = error
    assert (error.encoding, error.object, error.start, error.end) == ('charmap', b'AB', 0, 1)
    return ('?', Position())
register_error(handler)
assert charmap_decode(b'AB', Mapping(), 'custom') == ('?Z', 2)
assert events == [65, 90]
seen = []
def invalid(error):
    seen.append(error)
    error.start = 20
    error.reason = 'changed'
    return ('X', -1)
register_error(invalid)
try:
    charmap_encode('AB', {66: 66}, 'custom')
except UnicodeEncodeError as error:
    assert error is seen[0]
    assert (error.start, error.end, error.reason) == (0, 1, 'character maps to <undefined>')
else:
    assert False
problem = ValueError('mapping failure')
class Bad:
    def __getitem__(self, key):
        raise problem
try:
    charmap_decode(b'A', Bad())
except ValueError as error:
    assert error is problem
else:
    assert False
`);
});

it.each(["encode","decode"])("keeps cancellation in guest charmap %s mapping uncatchable",operation=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
class Mapping:
    def __getitem__(self, key):
        cancel()
        raise ValueError('guest failure')
try:
    charmap_${operation}(${operation==="encode"?"'A'":"b'A'"}, Mapping())
except ValueError:
    pass
`)).toThrow(ExecutionLimitError);
});


for(const width of [16,32] as const){
  for(const order of [-1,0,1] as const){
    for(const replacement of ["'\\ud800'","b'!'"]){
      it.each([false,true])(`restores rejected UTF-${width} replacement fields (order=${order}, replacement=${replacement}, reused=%s)`,reused=>{
        const encoding=`utf-${width}${order===0?"":order===-1?"-le":"-be"}`;
        fixture(undefined,order).run(`
source = '\\ud800A\\udfffZ'
seen = []
events = []
class Position:
    def __index__(self):
        events.append('index')
        seen[-1].start = 90
        seen[-1].end = 91
        seen[-1].reason = 'index mutation'
        return -1
def handler(error):
    seen.append(error)
    if ${reused?"len(seen) == 1":"False"}:
        return ('?', error.end)
    error.encoding = 'changed encoding'
    error.object = 'changed object'
    error.start = 42
    error.end = 43
    error.reason = 'changed reason'
    return (${replacement}, Position())
register_error(handler)
try:
    encode${width}(source)
except UnicodeEncodeError as error:
    assert error is seen[0]
    assert error is seen[-1]
    assert error.encoding == 'changed encoding'
    assert error.object == 'changed object'
    assert (error.start, error.end, error.reason) == (${reused?2:0}, ${reused?3:1}, 'surrogates not allowed'), 'rejected replacement location'
    assert error.args == (${JSON.stringify(encoding)}, source, 0, 1, 'surrogates not allowed')
else:
    assert False
assert events == ['index']
assert len(seen) == ${reused?2:1}
`);
      });
    }
  }
}
