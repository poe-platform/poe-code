import {expect,it} from "vitest";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";

// Binding-level tests use compiled guest functions and the real exception and
// descriptor machinery. They do not establish public module/import coverage.
function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:500000,maxAllocatedBytes:8000000,signal}),values=new RuntimeValues(meter);
  const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>();
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter),registry=new RuntimeCodecRegistry(values,meter);
  globals.set("__name__",values.string("__main__"));
  const unavailable=():never=>{throw Error("unavailable test capability");};
  const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unavailable,lookupWrite:unavailable,flush:unavailable}});
  for(const name of ["BaseException","ValueError","TypeError","LookupError","IndexError","AssertionError","UnicodeEncodeError","UnicodeDecodeError","OverflowError"] as const)builtins.set(name,types.exceptionType(name));
  for(const [name,value] of Object.entries({object:types.object,type:types.type,str:types.stringType(),tuple:types.tupleType(),int:types.integerType()}))builtins.set(name,value);
  const text=(value:RuntimeValue)=>{if(value.kind!=="str")return unavailable();return [...value.value].map(point=>String.fromCodePoint(point)).join("");};
  for(const [name,value] of createRuntimeCoreCodecFunctions(registry))builtins.set(name,value);
  builtins.set("lookup_error",values.builtinFunction({name:"lookup_error",invoke:args=>registry.lookupError(text(args[0]))}));
  builtins.set("register_error",values.builtinFunction({name:"register_error",invoke:(args,_kw,_meter,context)=>{registry.registerError(text(args[0]),args[1],context!);return values.none;}}));
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  return {values,builtins,registry,meter,types,empty:values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter)),run:(source:string)=>{try{return executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter);}catch(error){if(error instanceof RuntimeRaisedException)throw new Error(error.value.type.value.name+": "+JSON.stringify(runtimeExceptionPayload(error.value)?.args.items.map(value=>value.kind==="str"?text(value):value.kind)));throw error;}}};
}

it.each([
  ["ascii_encode", "'é'", true],
  ["latin_1_encode", "'Ā'", true],
  ["utf_8_encode", "chr(55296)", true],
  ["ascii_decode", "b'\\xff'", false],
  ["utf_8_decode", "b'\\xff'", false]
] as const)("preserves replacement and resume validation order in %s",(codec,source,encode)=>{
  fixture().run(`
events = []
failure = ValueError('position failed')
class Position:
    def __index__(self):
        events.append('index')
        if mode == 'failure':
            raise failure
        if mode == 'overflow':
            return 1 << 63
        if mode == 'invalid':
            return 'bad'
        return -1
def handler(error):
    return (None, Position())
register_error('order_probe', handler)
for mode in ('normal', 'failure', 'overflow', 'invalid'):
    events.clear()
    try:
        ${codec}(${source}, 'order_probe')
    except (TypeError, ValueError, OverflowError) as error:
        assert events == ${encode ? "['index']" : "[]"}
        if ${encode ? "True" : "False"} and mode == 'failure':
            assert error is failure
        elif ${encode ? "True" : "False"} and mode == 'overflow':
            assert type(error) is OverflowError
            assert error.args == ('Python int too large to convert to C ssize_t',)
        elif ${encode ? "True" : "False"} and mode == 'invalid':
            assert type(error) is TypeError
            assert error.args == ('__index__ returned non-int (type str)',)
        else:
            assert type(error) is TypeError
            assert error.args == ('${encode ? "encoding error handler must return (str/bytes, int) tuple" : "decoding error handler must return (str, int) tuple"}',)
    else:
        assert False
`);
});

it.each([false,true])("keeps cancellation fatal inside an invalid replacement's resume position (throws=%s)",throws=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
class Position:
    def __index__(self):
        cancel()
        ${throws ? "raise ValueError('position failed')" : "return -1"}
def handler(error):
    return (None, Position())
register_error('order_probe', handler)
try:
    utf_8_encode(chr(55296), 'order_probe')
except BaseException:
    pass
`)).toThrow(ExecutionLimitError);
});

it("rejects malformed error-handler tuples before invoking their position",()=>{
  fixture().run(`
class Position:
    def __index__(self):
        raise AssertionError('position of malformed tuple')
def handler(error):
    return result
register_error('order_probe', handler)
for result in ((None, Position(), None), (Position(),), [None, Position()]):
    for codec, source in ((ascii_encode, 'é'), (latin_1_encode, 'Ā'), (utf_8_encode, chr(55296)), (ascii_decode, b'\\xff'), (utf_8_decode, b'\\xff')):
        try:
            codec(source, 'order_probe')
        except TypeError as error:
            if codec in (ascii_encode, latin_1_encode, utf_8_encode):
                assert error.args == ('encoding error handler must return (str/bytes, int) tuple',)
            else:
                assert error.args == ('decoding error handler must return (str, int) tuple',)
        else:
            assert False
`);
});

it("binds the six positional-only core codec functions with lazy errors and UTF-8 finality",()=>{
  fixture().run(`
for encoder in (ascii_encode, latin_1_encode, utf_8_encode):
    assert encoder('abc') == (b'abc', 3)
    assert encoder('', 'unknown') == (b'', 0)
    assert encoder('abc', None) == (b'abc', 3)
    for args, message in [((), encoder.__name__ + ' expected at least 1 argument, got 0'), ((None,), encoder.__name__ + '() argument 1 must be str, not None'), (('a', 1), encoder.__name__ + '() argument 2 must be str or None, not int'), (('a', None, None), encoder.__name__ + ' expected at most 2 arguments, got 3')]:
        try:
            encoder(*args)
        except TypeError as error:
            assert error.args == (message,)
        else:
            assert False
    try:
        encoder(str='a')
    except TypeError as error:
        assert error.args == ('_codecs.' + encoder.__name__ + '() takes no keyword arguments',)
    else:
        assert False
for decoder in (ascii_decode, latin_1_decode, utf_8_decode):
    assert decoder(b'abc') == ('abc', 3)
    assert decoder(b'', 'unknown') == ('', 0)
    assert decoder(b'abc', None) == ('abc', 3)
    try:
        decoder('abc', 1)
    except TypeError as error:
        assert error.args == ("a bytes-like object is required, not 'str'",)
    else:
        assert False
assert latin_1_encode('é') == (b'\\xe9', 1)
assert latin_1_decode(b'\\xff') == ('ÿ', 1)
assert utf_8_encode('🐍') == (b'\\xf0\\x9f\\x90\\x8d', 1)
assert utf_8_decode(b'A\\xc3') == ('A', 1)
assert utf_8_decode(b'A\\xc3', 'replace', True) == ('A�', 2)
`);
});

it.each(["ascii","latin_1","utf_8"])("retains %s encoding source identity, cached errors, index side effects and rejected replacement fields",codec=>{
  fixture().run(`
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string')
class Result(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual tuple')
    def __len__(self):
        raise AssertionError('virtual tuple')
class Position:
    def __index__(self):
        events.append('index')
        return -1
source = Text('\\ud800X\\ud800Z')
seen = []
events = []
def handler(error):
    seen.append(error)
    assert error.object is source, 'assert error.object is source'
    return Result((Text('?'), error.end))
register_error('custom', handler)
assert ${codec}_encode(source, 'custom') == (b'?X?Z', 4)
assert seen[0] is seen[1], 'assert seen[0] is seen[1]'
original = seen[0].args
assert original[1] is source, 'assert original[1] is source'
assert original[2:4] == (0, 1), 'assert original[2:4] == (0, 1)'
def rejected(error):
    seen.append(error)
    error.object = 'changed'
    error.encoding = 'changed'
    error.reason = 'changed'
    error.start = 42
    error.end = 43
    return ('🐍', Position())
register_error('custom', rejected)
try:
    ${codec}_encode(source, 'custom')
except UnicodeEncodeError as error:
    assert error is seen[-1], 'assert error is seen[-1]'
    assert error.object == 'changed', "assert error.object == 'changed'"
    assert error.encoding == 'changed', "assert error.encoding == 'changed'"
    assert (error.start, error.end) == (0, 1), 'assert (error.start, error.end) == (0, 1)'
    assert error.reason == ${JSON.stringify(codec==="utf_8"?"surrogates not allowed":`ordinal not in range(${codec==="ascii"?128:256})`)}
    assert error.__traceback__ is not None, 'assert error.__traceback__ is not None'
else:
    assert False
assert events == ['index']
`);
});

it.each(["ascii","utf_8"])("uses %s decode recovery's mutated object after negative __index__",codec=>{
  fixture().run(`
seen = []
class Position:
    def __index__(self):
        seen[-1].object = b'QZ'
        return -1
def handler(error):
    seen.append(error)
    error.object = None
    return ('!', Position())
register_error('custom', handler)
assert ${codec}_decode(b'\\xffAB', 'custom') == ('!Z', ${codec==="utf_8"?2:3})
assert seen[0].object == b'QZ'
assert seen[0].args == (${JSON.stringify(codec==="ascii"?"ascii":"utf-8")}, b'\\xffAB', 0, 1, ${JSON.stringify(codec==="ascii"?"ordinal not in range(128)":"invalid start byte")})
`);
});

it.each(["ascii","latin_1","utf_8"])("preserves %s native error fast paths while consulting registered fallback handlers",codec=>{
  fixture().run(`
events = []
def handler(error):
    events.append((error.start, error.end))
    return (b'!', error.end)
for name in ('strict', 'ignore', 'replace', 'backslashreplace', 'xmlcharrefreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
    register_error(name, handler)
assert ${codec}_encode('\\udc80\\ud800', 'surrogateescape') == (b'\\x80!', 2)
assert events == [(1, 2)]
assert ${codec}_encode('\\ud800', 'namereplace') == (b'!', 1)
assert ${codec}_encode('\\ud800', 'replace') == (b'?', 1)
${codec==="utf_8"?"assert utf_8_encode('\\ud800', 'strict') == (b'!', 1)":""}
`);
});

it.each(["ascii_encode","latin_1_encode","utf_8_encode","ascii_decode","utf_8_decode"])("keeps cancellation fatal through %s registered recovery",name=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def handler(error):
    cancel()
    return ('!', error.end)
register_error('custom', handler)
try:
    ${name}(${name.endsWith("encode")?"'\\ud800'":"b'\\xff'"}, 'custom')
except BaseException:
    pass
`)).toThrow(ExecutionLimitError);
});

it.each(["ascii_encode","latin_1_encode"])("preserves %s strict exception source subtype identity",name=>{
  fixture().run(`
class Text(str):
    pass
source = Text('\\ud800')
try:
    ${name}(source)
except UnicodeEncodeError as error:
    assert error.object is source
    assert error.args[1] is source
else:
    assert False
`);
});

it("validates embedded nulls and surrogate error names even for empty input",()=>{
  fixture().run(`
class Name(str):
    def __str__(self):
        raise AssertionError('virtual name')
for function, source, expected in ((ascii_encode, '', b''), (latin_1_encode, '', b''), (utf_8_encode, '', b''), (ascii_decode, b'', ''), (latin_1_decode, b'', ''), (utf_8_decode, b'', '')):
    assert function(source, Name('unknown')) == (expected, 0)
    try:
        function(source, 'strict\\x00')
    except ValueError as error:
        assert error.args == ('embedded null character',)
    else:
        assert False
    name = Name('\\ud800')
    try:
        function(source, name)
    except UnicodeEncodeError as error:
        assert error.object is name
        assert (error.encoding, error.start, error.end, error.reason) == ('utf-8', 0, 1, 'surrogates not allowed')
    else:
        assert False
`);
});

it.each(["ok","invalid-errors","invalid-final","cancel-final","cancel-acquire"])("holds and releases decoder buffer exports in argument order: %s",mode=>{
  const controller=new AbortController(),state=fixture(controller.signal),{values,meter,types,empty}=state;
  const events:string[]=[],source=values.instance(types.object),final=values.instance(types.object);
  let data=[65,195];
  const fn=createRuntimeCoreCodecFunctions(state.registry).get("utf_8_decode")!;
  const truth=values.builtinFunction({name:"__bool__",invoke:()=>{
    events.push("final");data=[66,67];
    if(mode==="cancel-final")controller.abort();
    if(mode==="invalid-final")throw Error("final failed");
    return values.boolean(true);
  }});
  const invoke=()=>fn.value.invoke([source,mode==="invalid-errors"?values.integer(42):values.none,final],empty,meter,{
    call:()=>truth.value.invoke([],empty,meter),
    lookupSpecial:(object,name)=>object===final&&name==="__bool__"?truth:undefined,
    buffers:{acquireSimple(object){
      expect(object).toBe(source);events.push("acquire");
      if(mode==="cancel-acquire")controller.abort();
      return {byteLength:2,copy:()=>{events.push("copy");return ImmutableBytes.copyOf(data,meter);},release:()=>{events.push("release");}};
    }}
  });
  if(mode==="ok"){
    const result=invoke();
    expect(result.kind).toBe("tuple");
    if(result.kind!=="tuple")throw Error("expected tuple");
    expect(result.items[0]).toMatchObject({kind:"str"});
    const text=result.items[0];
    if(text.kind!=="str")throw Error("expected text");
    expect([...text.value]).toEqual([66,67]);
    expect(result.items[1]).toMatchObject({kind:"int",value:2n});
    expect(events).toEqual(["acquire","final","copy","release"]);
  }else{
    expect(invoke).toThrow(mode.startsWith("cancel")?ExecutionLimitError:mode==="invalid-final"?"final failed":"utf_8_decode() argument 2 must be str or None, not int");
    expect(events).toEqual(mode.endsWith("final")?["acquire","final","release"]:["acquire","release"]);
  }
});

it.each(["ascii_decode","latin_1_decode","utf_8_decode"])("rejects nonbuffers in %s without iterable or __bytes__ coercion",name=>{
  const {registry,values,types,meter,empty}=fixture(),fn=createRuntimeCoreCodecFunctions(registry).get(name)!;
  const source=values.instance(types.object),events:string[]=[];
  expect(()=>fn.value.invoke([source],empty,meter,{call:()=>{throw Error("must not call guest coercion");},typeName:()=>"Export",buffers:{acquireSimple(){events.push("acquire");return undefined;}}})).toThrow("a bytes-like object is required, not 'Export'");
  expect(events).toEqual(["acquire"]);
});

it("readbuffer_encode copies raw bytes and UTF-8 text with native argument validation",()=>{
  fixture().run(String.raw`
class Text(str):
    def __str__(self):
        raise AssertionError('virtual text')
for source, expected in [(b'abc', b'abc'), (Text('é🐍'), b'\xc3\xa9\xf0\x9f\x90\x8d')]:
    result = readbuffer_encode(source, Text('unknown'))
    assert result == (expected, len(expected))
    assert result[0] is not source
empty = b''
assert readbuffer_encode(empty, None)[0] is empty
for args, message in [((), 'readbuffer_encode expected at least 1 argument, got 0'), ((b'', None, None), 'readbuffer_encode expected at most 2 arguments, got 3'), ((None,), "a bytes-like object is required, not 'NoneType'"), (([],), "a bytes-like object is required, not 'list'"), ((b'', 42), 'readbuffer_encode() argument 2 must be str or None, not int')]:
    try:
        readbuffer_encode(*args)
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
try:
    readbuffer_encode(data=b'')
except TypeError as error:
    assert error.args == ('_codecs.readbuffer_encode() takes no keyword arguments',)
else:
    assert False
try:
    readbuffer_encode(b'', 'unknown\0')
except ValueError as error:
    assert error.args == ('embedded null character',)
else:
    assert False
bad = Text('prefix\ud800suffix')
for args in [(bad, 42), (bad, 'ignore'), (b'', bad)]:
    try:
        readbuffer_encode(*args)
    except UnicodeEncodeError as error:
        assert error.object is bad
        assert error.args[1] is bad
        assert (error.encoding, error.start, error.end, error.reason) == ('utf-8', 6, 7, 'surrogates not allowed')
    else:
        assert False
`);
});

it.each(["ok","invalid-errors","copy-failure","acquire-failure","cancel-acquire","cancel-copy"])("readbuffer_encode releases the explicit buffer export: %s",mode=>{
  const controller=new AbortController(),{registry,values,types,meter,empty}=fixture(controller.signal);
  const fn=createRuntimeCoreCodecFunctions(registry).get("readbuffer_encode");
  expect(fn).toBeDefined();
  const source=values.instance(types.object),events:string[]=[];
  const invoke=()=>fn!.value.invoke([source,mode==="invalid-errors"?values.integer(1):values.none],empty,meter,{
    call:()=>{throw Error("unexpected guest coercion");},typeName:value=>value===source?"Export":value.kind,
    buffers:{acquireSimple(value){
      expect(value).toBe(source);events.push("acquire");
      if(mode==="acquire-failure")throw Error("export failed");
      if(mode==="cancel-acquire")controller.abort();
      return {byteLength:3,copy:()=>{
        events.push("copy");
        if(mode==="copy-failure")throw Error("copy failed");
        const bytes=ImmutableBytes.copyOf([0,128,255],meter);
        if(mode==="cancel-copy")controller.abort();
        return bytes;
      },release:()=>{events.push("release");}};
    }}
  });
  if(mode==="ok"){
    const result=invoke();
    expect(result.kind).toBe("tuple");
    if(result.kind!=="tuple"||result.items[0].kind!=="bytes")throw Error("expected encoded bytes tuple");
    expect([...result.items[0].value]).toEqual([0,128,255]);
    expect(result.items[1]).toMatchObject({kind:"int",value:3n});
  }else expect(invoke).toThrow(mode.startsWith("cancel")?ExecutionLimitError:mode==="invalid-errors"?"readbuffer_encode() argument 2 must be str or None, not int":mode==="copy-failure"?"copy failed":"export failed");
  expect(events).toEqual(mode==="acquire-failure"?["acquire"]:mode==="invalid-errors"||mode==="cancel-acquire"?["acquire","release"]:["acquire","copy","release"]);
});

it("readbuffer_encode preserves every byte and canonical small-byte identities",()=>{
  const {registry,values,meter,empty}=fixture();
  const fn=createRuntimeCoreCodecFunctions(registry).get("readbuffer_encode")!;
  for(const data of [new Uint8Array(),...Array.from({length:256},(_,byte)=>Uint8Array.of(byte)),Uint8Array.from({length:256},(_,byte)=>byte)]){
    const source=values.bytes(data),result=fn.value.invoke([source],empty,meter);
    if(result.kind!=="tuple"||result.items[0].kind!=="bytes")throw Error("expected encoded bytes tuple");
    expect([...result.items[0].value]).toEqual([...data]);
    expect(result.items[1]).toMatchObject({kind:"int",value:BigInt(data.length)});
    expect(result.items[0]===source).toBe(data.length<=1);
  }
});
