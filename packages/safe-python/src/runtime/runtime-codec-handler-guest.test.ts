import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";

/** Compiled guest integration, not public codecs-module compatibility evidence.
 * Only the registry entry points are injected; exceptions, subclasses, mutation,
 * calls, recursive frames and cancellation use real interpreter components. */
function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:8000000,signal}),values=new RuntimeValues(meter);
  const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>();
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter),registry=new RuntimeCodecRegistry(values,meter);
  globals.set("__name__",values.string("__main__"));
  const unavailable=():never=>{throw Error("unavailable test capability");};
  const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unavailable,lookupWrite:unavailable,flush:unavailable}});
  for(const name of ["ValueError","TypeError","LookupError","IndexError","AssertionError","UnicodeEncodeError","UnicodeDecodeError","UnicodeTranslateError","OverflowError"] as const)builtins.set(name,types.exceptionType(name));
  for(const [name,value] of Object.entries({object:types.object,type:types.type,str:types.stringType(),tuple:types.tupleType(),int:types.integerType()}))builtins.set(name,value);
  const text=(value:RuntimeValue)=>{if(value.kind!=="str")return unavailable();return [...value.value].map(point=>String.fromCodePoint(point)).join("");};
  builtins.set("lookup_error",values.builtinFunction({name:"lookup_error",invoke:args=>registry.lookupError(text(args[0]))}));
  builtins.set("register_error",values.builtinFunction({name:"register_error",invoke:(args,_kw,_meter,context)=>{registry.registerError(text(args[0]),args[1],context!);return values.none;}}));
  builtins.set("decode_error",values.builtinFunction({name:"decode_error",invoke:(args,_kw,_meter,context)=>{const result=registry.handleError(text(args[0]),args[1],"decode",2,context!);return values.tuple([result.replacement,values.integer(result.position),result.object!]);}}));
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  return {values,builtins,globals,run:(source:string)=>{try{return executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter);}catch(error){if(error instanceof RuntimeRaisedException)throw new Error(error.value.type.value.name+": "+JSON.stringify(runtimeExceptionPayload(error.value)?.args.items?.map(value=>value.kind==="str"?text(value):value.kind)));throw error;}}};
}

it("uses native Unicode exception fields despite guest attribute overrides",()=>{
  fixture().run(`
class Error(UnicodeEncodeError):
    def __getattribute__(self, name):
        if name in ('object', 'start', 'end', 'encoding'):
            raise AssertionError('virtual field access')
        return object.__getattribute__(self, name)
e = Error('ascii', 'é🐍', -4, 99, 'reason')
assert lookup_error('replace')(e) == ('??', 2)
assert lookup_error('backslashreplace')(e) == ('\\\\xe9\\\\U0001f40d', 2)
assert lookup_error('xmlcharrefreplace')(e) == ('&#233;&#128013;', 2)
assert e.args == ('ascii', 'é🐍', -4, 99, 'reason')
e.object = 'z'
assert lookup_error('replace')(e) == ('?', 1)
try:
    lookup_error('strict')(e)
except Error as caught:
    assert caught is e
else:
    assert False
`);
});

it.each(["UnicodeEncodeError", "UnicodeDecodeError"])("preserves a surrogate encoding name's subtype identity in %s handler failures",kind=>{
  fixture().run(`
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string')
class Error(${kind}):
    def __getattribute__(self, name):
        if name == 'encoding':
            raise AssertionError('virtual encoding')
        return object.__getattribute__(self, name)
name = Text('prefix\\ud800suffix')
original = Error('ascii', ${kind==="UnicodeEncodeError"?"'é'":"b'\\xff'"}, 0, 1, 'original')
original.encoding = name
try:
    lookup_error('surrogatepass')(original)
except UnicodeEncodeError as error:
    assert error is not original
    assert error.object is name, 'encoding name identity'
    assert error.args[1] is name, 'encoding name args identity'
    assert type(error.object) is Text
    assert (error.encoding, error.start, error.end, error.reason) == ('utf-8', 6, 7, 'surrogates not allowed')
else:
    assert False
assert original.args[0] == 'ascii'
assert original.reason == 'original'
`);
});

it("rereads decode object after guest __index__, accepting tuple and string subtypes without their overrides",()=>{
  fixture().run(`
e = UnicodeDecodeError('ascii', b'\\xffA', 0, 1, 'reason')
original_args = e.args
replacement_object = b'xyzq'
class Index:
    def __index__(self):
        e.object = replacement_object
        return -1
class Result(tuple):
    def __len__(self):
        raise AssertionError('virtual length')
    def __getitem__(self, key):
        raise AssertionError('virtual item')
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string')
replacement = Text('?')
def handler(error):
    assert error is e
    error.object = None
    return Result((replacement, Index()))
register_error('custom', handler)
result = decode_error('custom', e)
assert result[0] is replacement
assert result[1] == 3
assert result[2] is replacement_object
assert e.args is original_args
`);
});

it("supports recursive registered error callbacks and retains registration mutations",()=>{
  fixture().run(`
events = []
inner = UnicodeEncodeError('ascii', 'é', 0, 1, 'inner')
outer = UnicodeEncodeError('ascii', 'Ā', 0, 1, 'outer')
def recursive(error):
    events.append(error)
    if error is outer:
        result = lookup_error('recursive')(inner)
        return (result[0] + '?', error.end)
    register_error('recursive', lookup_error('ignore'))
    return lookup_error('replace')(error)
register_error('recursive', recursive)
assert lookup_error('recursive')(outer) == ('??', 1)
assert events == [outer, inner]
assert lookup_error('recursive')(outer) == ('', 1)
`);
});

it("formats wrong-exception diagnostics from native qualified type metadata",()=>{
  fixture().run(`
class Other(ValueError):
    __module__ = 'codec_test'
    __qualname__ = 'Outer.Other'
try:
    lookup_error('ignore')(Other())
except TypeError as error:
    assert error.args == ("don't know how to handle codec_test.Outer.Other in error callback",)
else:
    assert False
`);
});

it("does not start generator callbacks when a codec requires an immediate return tuple",()=>{
  fixture().run(`
e = UnicodeDecodeError('ascii', b'\\xffA', 0, 1, 'reason')
events = []
def handler(error):
    events.append('started')
    yield ('?', 1)
register_error('generator', handler)
try:
    decode_error('generator', e)
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    assert False
assert events == []
`);
});

it.each([false,true])("cancellation escapes recursive guest handlers even inside bare except (raises=%s)",raises=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
e = UnicodeEncodeError('ascii', 'é', 0, 1, 'reason')
def handler(error):
    cancel()
    ${raises?"raise ValueError('failure')":"return ('?', 1)"}
register_error('cancel', handler)
try:
    lookup_error('cancel')(e)
except:
    recovered = True
`)).toThrow(ExecutionLimitError);
  expect(state.globals.has("recovered")).toBe(false);
});

it("publishes standard handler callable metadata and positional-only argument errors",()=>{
  fixture().run(`
for name in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
    handler = lookup_error(name)
    function_name = name if name.startswith('surrogate') else name + '_errors'
    assert handler.__name__ == function_name
    assert handler.__qualname__ == function_name
    assert handler.__module__ is None
    assert handler.__self__ is None
    assert handler.__text_signature__ == '($self, object, /)'
    try:
        handler()
    except TypeError as error:
        assert error.args == (function_name + '() takes exactly one argument (0 given)',)
    else:
        assert False
    try:
        handler(object=ValueError())
    except TypeError as error:
        assert error.args == (function_name + '() takes no keyword arguments',)
    else:
        assert False
`);
});

it("rejects primitive handler arguments without requiring canonical type publication",()=>{
  fixture().run(`
for value, name in ((b'', 'bytes'), (None, 'NoneType'), (NotImplemented, 'NotImplementedType'), ([], 'list'), ({}, 'dict'), (object, 'type')):
    try:
        lookup_error('ignore')(value)
    except TypeError as error:
        assert error.args == ("don't know how to handle " + name + " in error callback",)
    else:
        assert False
`);
});

it.each(["strict", "surrogatepass", "surrogateescape"])("%s chains rejected errors to the active guest exception",handler=>{
  fixture().run(`
original = UnicodeEncodeError('ascii', 'é', 0, 1, 'original')
prior = ValueError('active')
cause = ValueError('explicit cause')
original.__cause__ = cause
try:
    raise prior
except ValueError:
    try:
        lookup_error('${handler}')(original)
    except UnicodeEncodeError as caught:
        assert caught is original
        assert caught.__context__ is prior, 'active handler context'
        assert caught.__cause__ is cause
        assert caught.__suppress_context__ is True
    else:
        assert False
assert original.args == ('ascii', 'é', 0, 1, 'original')
`);
});

it.each([
  ["strict", "ValueError('original')"],
  ["surrogateescape", "UnicodeDecodeError('ascii', b'A', 0, 1, 'original')"],
  ["surrogateescape", "UnicodeDecodeError('ascii', b'', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeEncodeError('utf-8', 'A', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeEncodeError('utf-16', 'A', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeEncodeError('utf-32', 'A', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-8', b'AA', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-8', b'AAA', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-8', b'\\xe0\\xa0\\x80', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-16', b'A', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-16', b'AA', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-32', b'AAA', 0, 1, 'original')"],
  ["surrogatepass", "UnicodeDecodeError('utf-32', b'AAAA', 0, 1, 'original')"]
])("chains %s rejection for %s and removes only the context cycle edge",(handler,original)=>{
  fixture().run(`
original = ${original}
arguments = original.args
old = ValueError('old context')
original.__context__ = old
prior = ValueError('active')
try:
    raise prior
except ValueError:
    prior.__context__ = original
    try:
        lookup_error('${handler}')(original)
    except ValueError as caught:
        assert caught is original
        assert caught.__context__ is prior
        assert prior.__context__ is None
        assert caught.args is arguments
    else:
        assert False
try:
    lookup_error('${handler}')(original)
except ValueError as caught:
    assert caught.__context__ is prior
else:
    assert False
`);
});

it("successful standard handlers do not chain their input exception",()=>{
  fixture().run(`
old = ValueError('old context')
prior = ValueError('active')
for name in ('ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogatepass', 'surrogateescape'):
    original = UnicodeEncodeError('utf-8', '\\udc80', 0, 1, 'original')
    original.__context__ = old
    arguments = original.args
    try:
        raise prior
    except ValueError:
        lookup_error(name)(original)
        assert original.__context__ is old
        assert original.args is arguments
`);
});

it("native handler chaining follows the caller after a generator resumes",()=>{
  fixture().run(`
original = UnicodeEncodeError('ascii', 'é', 0, 1, 'original')
def resumed():
    yield 'ready'
    lookup_error('strict')(original)
iterator = resumed()
assert next(iterator) == 'ready'
prior = ValueError('resume caller')
try:
    raise prior
except ValueError:
    try:
        next(iterator)
    except UnicodeEncodeError as caught:
        assert caught is original
        assert caught.__context__ is prior
    else:
        assert False
`);
});
