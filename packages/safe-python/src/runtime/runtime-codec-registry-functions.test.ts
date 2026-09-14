import {expect,it} from "vitest";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {createRuntimeCodecRegistryFunctions} from "./runtime-codec-registry-functions.js";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
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
  for(const [name,value] of createRuntimeCodecRegistryFunctions(registry))builtins.set(name,value);
  const decodeText=createRuntimeStringDecoder((bytes,encoding,errors,_meter,invocation)=>registry.transform("decode",values.bytes(bytes.toUint8Array(meter)),encoding,errors,invocation!,true),values);
  builtins.set("decode_text",values.builtinFunction({name:"decode_text",invoke:(args,_keywords,meter,invocation)=>decodeText(args[0],"custom","strict",meter,invocation)}));
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  return {values,builtins,registry,meter,types,empty:values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter)),run:(source:string)=>{try{return executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter);}catch(error){if(error instanceof RuntimeRaisedException)throw new Error(error.value.type.value.name+": "+JSON.stringify(runtimeExceptionPayload(error.value)?.args.items.map(value=>value.kind==="str"?text(value):value.kind)));throw error;}}};
}

it.each(["encode","decode"])("uses guest keyword diagnostics before %s registry lookup",operation=>{
  fixture().run(`
events = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        return False
    def __str__(self):
        events.append('str')
        return 'visible'
def search(name):
    raise AssertionError('lookup before keyword validation')
register(search)
try:
    ${operation}('x', **{Key('encodign'): 'custom'})
except TypeError as error:
    assert error.args == ("${operation}() got an unexpected keyword argument 'visible'. Did you mean 'encoding'?",)
else:
    assert False
assert events == ['obj', 'encoding', 'errors', 'str']
`);
});

it("preserves retained normalized name identity after failed searches and unregister",()=>{
  fixture().run(`
seen = []
mode = 'miss'
info = (None, None, None, None)
def search(name):
    seen.append(name)
    if mode == 'failure':
        raise ValueError('search failed')
    if mode == 'success':
        return info
register(search)
for spelling, mode in [('Codec-Identity-Probe', 'miss'), ('CODEC IDENTITY PROBE', 'failure'), ('codec_identity_probe', 'success')]:
    try:
        lookup(spelling)
    except (LookupError, ValueError):
        pass
unregister(search)
register(search)
assert lookup('codec-identity-probe') is info
assert len(seen) == 4
for name in seen:
    assert name is seen[0]
`);
});

it("canonicalizes only empty and Latin-1 decoder results without consulting guest conversion or tuple overrides",()=>{
  fixture().run(`
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
    def __len__(self):
        raise AssertionError('virtual length')
    def __getitem__(self, key):
        raise AssertionError('virtual item')
class Pair(tuple):
    def __len__(self):
        raise AssertionError('virtual tuple length')
    def __getitem__(self, key):
        raise AssertionError('virtual tuple item')
def decoder(source, errors='strict'):
    return Pair((result, None))
def search(name):
    if name == 'custom':
        return (None, decoder, None, None)
register(search)
for content in ('', '\\x00', 'A', 'é', 'ÿ', 'Ā', '🐍', '\\ud800', 'two characters', '\\x00\\ud800🐍'):
    result = Text(content)
    assert decode(b'x', 'custom') is result
    actual = decode_text(b'x')
    assert actual == content
    if content in ('', '\\x00', 'A', 'é', 'ÿ'):
        assert type(actual) is str, 'text consumer retained a canonicalizable subtype'
        assert actual is content
        assert actual is not result
    else:
        assert actual is result, 'text consumer copied a noncanonical result'
    assert type(result) is Text
result = 'exact result'
assert decode_text(b'x') is result
`);
});

it("binds search registration, normalized cache identity and error-handler lifetime through guest calls",()=>{
  fixture().run(`
events = []
def codec(value, *errors):
    events.append((value, errors))
    return (events, None)
info = (codec, codec, None, None)
def search(name):
    events.append(name)
    return info
register(search)
assert lookup(' CuSTom--name ') is info
assert lookup('custom_name') is info
assert encode(obj='a', encoding='custom_name') is events
assert decode('b', 'custom_name', errors='strict') is events
assert events == ['custom_name', ('a', ()), ('b', ('strict',))]
unregister(None)
assert lookup('custom_name') is info
unregister(search)
try:
    lookup('custom_name')
except LookupError:
    pass
else:
    assert False
register_error('CUSTOM', codec)
assert lookup_error('CUSTOM') is codec
assert _unregister_error('CUSTOM') is True
assert _unregister_error('CUSTOM') is False
try:
    _unregister_error('strict')
except ValueError as error:
    assert error.args == ("cannot un-register built-in error handler 'strict'",)
else:
    assert False
`);
});

it("binds positional-only registry entry points before name and callable validation",()=>{
  fixture().run(`
for function in (lookup, register, unregister, lookup_error, _unregister_error):
    for args in ((), (None, None)):
        try:
            function(*args)
        except TypeError as error:
            assert error.args == ('_codecs.' + function.__name__ + '() takes exactly one argument (' + str(len(args)) + ' given)',)
        else:
            assert False
    try:
        function(encoding='utf8')
    except TypeError as error:
        assert error.args == ('_codecs.' + function.__name__ + '() takes no keyword arguments',)
    else:
        assert False
for function in (lookup, lookup_error, _unregister_error):
    try:
        function(None)
    except TypeError as error:
        assert error.args == (function.__name__ + '() argument must be str, not None',)
    else:
        assert False
try:
    register_error(None, None)
except TypeError as error:
    assert error.args == ('register_error() argument 1 must be str, not None',)
else:
    assert False
try:
    register_error('x')
except TypeError as error:
    assert error.args == ('register_error expected 2 arguments, got 1',)
else:
    assert False
`);
});

it.each(["encode","decode"])("binds %s keyword validation and conversion order",operation=>{
  fixture().run(`
function = ${operation}
for args, kwargs, message in [
    ((), {}, "missing required argument 'obj' (pos 1)"),
    ((), {'ob': 'x'}, "missing required argument 'obj' (pos 1)"),
    (('x', None), {'wat': 0}, "got an unexpected keyword argument 'wat'"),
    ((), {'obj': 'x', 'encodin': 'x'}, "got an unexpected keyword argument 'encodin'. Did you mean 'encoding'?"),
    ((), {'obj': 'x', 'encoding': None, 'wat': 0}, "got an unexpected keyword argument 'wat'"),
    ((), {'obj': 'x', 'encoding': 'x', 'errors': 'strict', 'wat': 0}, "takes at most 3 keyword arguments (4 given)"),
    (('x', None, None, None), {}, "takes at most 3 arguments (4 given)"),
    (('x', None), {}, "argument 'encoding' must be str, not None"),
    (('x', 'custom', None), {}, "argument 'errors' must be str, not None")
]:
    try:
        function(*args, **kwargs)
    except TypeError as error:
        assert error.args == ('${operation}() ' + message,)
    else:
        assert False
try:
    function('x', obj=None)
except TypeError as error:
    assert error.args == ("argument for ${operation}() given by name ('obj') and position (1)",)
else:
    assert False
`);
});

it("reads native string subtype storage and keeps invalid-name source identity",()=>{
  fixture().run(`
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
name = Text('CuStOm')
info = (None, None, None, None)
def search(name):
    assert name == 'custom'
    return info
register(search)
assert lookup(name) is info
bad = Text(chr(55296))
for function in (lookup, lookup_error, _unregister_error):
    try:
        function(bad)
    except UnicodeEncodeError as error:
        assert error.object is bad
        assert error.start == 0
        assert error.end == 1
        assert error.reason == 'surrogates not allowed'
    else:
        assert False
`);
});

it.each([false,true])("cancellation escapes the registry binding even when guest code catches failures (%s)",throws=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def search(name):
    cancel()
    ${throws?"raise ValueError('failure')":"return (None, None, None, None)"}
register(search)
try:
    lookup('custom')
except:
    pass
`)).toThrow(ExecutionLimitError);
});

it("exposes pinned lookup metadata on the actual binding",()=>{
  fixture().run(`
assert lookup.__name__ == 'lookup'
assert lookup.__qualname__ == 'lookup'
assert lookup.__module__ == '_codecs'
assert lookup.__text_signature__ == '($module, encoding, /)'
assert lookup.__doc__ == 'Looks up a codec tuple in the Python codec registry and returns a CodecInfo object.'
`);
});

it("uses the same registry for binding dispatch and UTF-8 negative-position recovery",()=>{
  fixture().run(`
events = []
def handler(error):
    events.append((error.start, error.end))
    return ('?', -1)
register_error('custom_error', handler)
def decoder(data, errors='strict'):
    return utf_8_decode(data, errors, True)
def search(name):
    if name == 'custom':
        return (utf_8_encode, decoder, None, None)
register(search)
assert decode(b'\\xffA', 'CUSTOM', 'custom_error') == '?A'
assert events == [(0, 1)]
assert encode(chr(55296) + 'A', 'CUSTOM', 'custom_error') == b'?A'
assert events == [(0, 1), (0, 1)]
def bad_handler(error):
    return ('?', -3)
register_error('custom_error', bad_handler)
try:
    decode(b'\\xffA', 'CUSTOM', 'custom_error')
except IndexError as error:
    assert error.args == ('position -1 from error handler out of bounds',)
    assert error.__notes__ == ["decoding with 'CUSTOM' codec failed"]
else:
    assert False
failure = ValueError('guest failure')
def broken_handler(error):
    raise failure
register_error('custom_error', broken_handler)
try:
    decode(b'\\xffA', 'CUSTOM', 'custom_error')
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["decoding with 'CUSTOM' codec failed"]
else:
    assert False
`);
});

it("isolates search paths and custom handler names between binding owners",()=>{
  const first=fixture(),second=fixture();
  first.run(`
def search(name):
    return (None, None, None, None)
register(search)
register_error('private', search)
assert lookup('private') == (None, None, None, None)
`);
  second.run(`
for function in (lookup, lookup_error):
    try:
        function('private')
    except LookupError:
        pass
    else:
        assert False
`);
});

it("validates name boundaries before invoking search or replacing a registered handler",()=>{
  fixture().run(`
events = []
def search(name):
    events.append(name)
    return (None, None, None, None)
register(search)
register_error('custom', search)
for bad, expected in [('bad' + chr(0), ValueError), (chr(55296), UnicodeEncodeError)]:
    for function, args in [(lookup, (bad,)), (lookup_error, (bad,)), (_unregister_error, (bad,)), (register_error, (bad, None)), (encode, ('x', bad)), (decode, (b'x', 'custom', bad))]:
        try:
            function(*args)
        except expected:
            pass
        else:
            assert False
assert events == []
assert lookup_error('custom') is search
`);
});
