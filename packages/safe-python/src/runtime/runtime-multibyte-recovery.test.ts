import {describe,expect,it} from "vitest";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeMultibyteRecovery} from "./runtime-multibyte-recovery.js";
import {gb2312Codec} from "./gb2312-codec.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";
import {hkscsCodec} from "./hkscs-codec.js";
import {gbkCodec} from "./gbk-codec.js";
import {eucJpCodec} from "./euc-jp-codec.js";
import {eucJis2004Codec,eucJisX0213Codec} from "./euc-jis-2004-codec.js";
import {shiftJisCodec} from "./shift-jis-codec.js";
import {shiftJis2004Codec,shiftJisX0213Codec} from "./shift-jis-2004-codec.js";
import {cp932Codec} from "./cp932-codec.js";
import {cp949Codec} from "./cp949-codec.js";
import {johabCodec} from "./johab-codec.js";
import {eucKrCodec} from "./euc-kr-codec.js";
import {gb18030Codec} from "./gb18030-codec.js";
import {taiwanCodecs} from "./taiwan-codec.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {PythonEncodeError} from "./encode-error.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {createRuntimeCodecRegistryFunctions} from "./runtime-codec-registry-functions.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";

describe.each([
  {codec:iso2022Jp2Codec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined},
  {codec:iso2022JpExtCodec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined},
  {codec:iso2022Jp1Codec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined},
  {codec:iso2022JpCodec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined},
  ...[eucJis2004Codec,eucJpCodec,gb2312Codec,gbkCodec,cp949Codec,eucKrCodec,johabCodec,hkscsCodec,...Object.values(taiwanCodecs)].map(codec=>({codec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"incomplete",shiftProbe:undefined})),
  {codec:eucJisX0213Codec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"incomplete",shiftProbe:undefined,spanBytes:[0xae,0xa1,65],spanWidth:2},
  {codec:shiftJisCodec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined},
  {codec:shiftJis2004Codec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined,escapedBackslash:"\\x81\\x5f"},
  {codec:shiftJisX0213Codec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:undefined,escapedBackslash:"\\x81\\x5f",spanBytes:[0x87,0x9f,65],spanWidth:2},
  {codec:cp932Codec,invalid:235,nestedInvalid:236,supplementary:undefined,trailingReason:"incomplete",shiftProbe:undefined},
  {codec:gb18030Codec,invalid:255,nestedInvalid:254,supplementary:"b'\\x94\\x39\\xfc\\x36'",trailingReason:"incomplete",shiftProbe:undefined},
  {codec:hzCodec,invalid:255,nestedInvalid:254,supplementary:undefined,trailingReason:"illegal",shiftProbe:"~{VP!$ND~}"}
].map(entry=>({escapedBackslash:"\\\\",spanBytes:[entry.invalid,entry.invalid,65],spanWidth:1,...entry})))("$codec.name registry recovery",({codec,invalid,nestedInvalid,supplementary,trailingReason,shiftProbe,escapedBackslash,spanBytes,spanWidth})=>{

// Binding-level tests use compiled guest functions and the real exception and
// descriptor machinery. They do not establish public module/import coverage.
function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:500000,maxAllocatedBytes:8000000,signal}),values=new RuntimeValues(meter);
  const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>();
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter),registry=new RuntimeCodecRegistry(values,meter);
  globals.set("__name__",values.string("__main__"));
  globals.set("bad",values.bytes(Uint8Array.of(invalid)));
  globals.set("nested_bad",values.bytes(Uint8Array.of(nestedInvalid)));
  const unavailable=():never=>{throw Error("unavailable test capability");};
  const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unavailable,lookupWrite:unavailable,flush:unavailable}});
  for(const name of ["BaseException","ValueError","TypeError","LookupError","IndexError","AssertionError","UnicodeEncodeError","UnicodeDecodeError","OverflowError"] as const)builtins.set(name,types.exceptionType(name));
  for(const [name,value] of Object.entries({object:types.object,type:types.type,str:types.stringType(),bytes:types.bytesType(),tuple:types.tupleType(),int:types.integerType()}))builtins.set(name,value);
  const text=(value:RuntimeValue)=>{if(value.kind!=="str")return unavailable();return [...value.value].map(point=>String.fromCodePoint(point)).join("");};
  builtins.set("gbencode",values.builtinFunction({name:"gbencode",invoke:(args,_keywords,_meter,invocation)=>{
    const recovery=new RuntimeMultibyteRecovery(registry,args[0],invocation!),state={value:codec.shift?.encoderInitialState??0n};
    return values.bytes(codec.encode(runtimeStringPayload(args[0])!.value,error=>recovery.recover(error,text(args[1]),replacement=>codec.encode(replacement,"strict",meter,state,false)),meter,state));
  }}));
  builtins.set("gbdecode",values.builtinFunction({name:"gbdecode",invoke:(args,_keywords,_meter,invocation)=>{
    if(args[0].kind!=="bytes")return unavailable();
    const recovery=new RuntimeMultibyteRecovery(registry,args[0],invocation!);
    return values.stringPoints(codec.decode(args[0].value.toUint8Array(meter),error=>recovery.recover(error,text(args[1])),meter).text);
  }}));
  builtins.set("gbincrementaldecode",values.builtinFunction({name:"gbincrementaldecode",invoke:(args,_keywords,_meter,invocation)=>{
    if(args[0].kind!=="bytes")return unavailable();
    const recovery=new RuntimeMultibyteRecovery(registry,args[0],invocation!);
    const decoder=new DoubleByteIncrementalDecoder(codec,error=>recovery.recover(error,text(invocation!.call(args[1],[]))));
    return values.stringPoints(decoder.decode(args[0].value.toUint8Array(meter),true,meter));
  }}));
  for(const [name,value] of createRuntimeCodecRegistryFunctions(registry))builtins.set(name,value);
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  return {values,builtins,registry,meter,types,empty:values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter)),run:(source:string)=>{try{return executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter);}catch(error){if(error instanceof RuntimeRaisedException)throw new Error(error.value.type.value.name+": "+JSON.stringify(runtimeExceptionPayload(error.value)?.args.items.map(value=>value.kind==="str"?text(value):value.kind)));throw error;}}};
}

it("preserves native fault spans through guest mutation and negative recovery",()=>{
  const state=fixture();
  state.builtins.set("span_input",state.values.bytes(Uint8Array.from(spanBytes)));
  state.run(`
seen = []
def handler(error):
    assert error.object == span_input
    assert (error.encoding, error.start, error.end, error.reason) == ('${codec.name}', 0, ${spanWidth}, 'illegal multibyte sequence')
    seen.append(error)
    error.object = None
    return ('Z', -1)
register_error('span_handler', handler)
assert gbdecode(span_input, 'span_handler') == 'ZA'
assert len(seen) == 1
assert seen[0].object is None
`);
});

it.each(["encode","decode"])("bypasses overridden native policies during %s",operation=>{
  fixture().run(`
def forbidden(error):
    raise AssertionError('overridden native policy ran')
for policy in ('strict', 'ignore', 'replace'):
    register_error(policy, forbidden)
source = ${operation==="encode"?"chr(55296)":"bad"}
try:
    gb${operation}(source, 'strict')
except ${operation==="encode"?"UnicodeEncodeError":"UnicodeDecodeError"} as error:
    assert (error.start, error.end) == (0, 1)
    assert error.reason == '${operation==="encode"?"illegal":trailingReason} multibyte sequence'
else:
    assert False
assert gb${operation}(source, 'ignore') == ${operation==="encode"?"b''":"''"}
assert gb${operation}(source, 'replace') == ${operation==="encode"?"b'?'":"chr(65533)"}
`);
});

it.each(["strict","ignore","replace"])("preserves cached exception fields across a decoder policy change to %s",policy=>{
  fixture().run(`
seen = []
errors = 'probe'
def current_errors():
    return errors
def forbidden(error):
    raise AssertionError('overridden native policy ran')
def handler(error):
    global errors
    seen.append(error)
    error.object = None
    error.encoding = 'changed'
    error.args = ('retained',)
    errors = '${policy}'
    return ('?', error.end)
register_error('probe', handler)
register_error('${policy}', forbidden)
${policy==="strict"?`try:
    gbincrementaldecode((bad + bad), current_errors)
except UnicodeDecodeError as error:
    assert error is seen[0]
    assert (error.start, error.end, error.reason) == (1, 2, '${trailingReason} multibyte sequence')
else:
    assert False`:`assert gbincrementaldecode((bad + bad), current_errors) == ${policy==="ignore"?"'?'":"'?' + chr(65533)"}
assert (seen[0].start, seen[0].end, seen[0].reason) == (0, 1, 'illegal multibyte sequence')`}
assert len(seen) == 1
assert seen[0].object is None
assert seen[0].encoding == 'changed'
assert seen[0].args == ('retained',)
`);
});

it.each(["encode","decode"])("chains a native strict %s failure to the active guest exception",operation=>{
  fixture().run(`
prior = ValueError('active caller')
try:
    raise prior
except ValueError:
    try:
        gb${operation}(${operation==="encode"?"chr(55296)":"bad"}, 'strict')
    except ${operation==="encode"?"UnicodeEncodeError":"UnicodeDecodeError"} as error:
        assert error.__context__ is prior
        assert error.__cause__ is None
        assert error.__suppress_context__ is False
    else:
        assert False
`);
});

it("chains cached strict decoder failures, breaks context cycles and preserves explicit causes",()=>{
  fixture().run(`
seen = []
policy = 'capture_context'
prior = ValueError('active caller')
cause = ValueError('explicit cause')
def current_errors():
    return policy
def handler(error):
    global policy
    seen.append(error)
    assert error.__context__ is None
    error.__cause__ = cause
    prior.__context__ = error
    policy = 'strict'
    return ('?', error.end)
register_error('capture_context', handler)
try:
    raise prior
except ValueError:
    try:
        gbincrementaldecode(bad + bad, current_errors)
    except UnicodeDecodeError as error:
        assert error is seen[0]
        assert error.__context__ is prior
        assert prior.__context__ is None
        assert error.__cause__ is cause
        assert error.__suppress_context__ is True
    else:
        assert False
`);
});

it("returns raw bytes for native encoder ignore without encoding replacement text",()=>{
  const state=fixture();
  state.builtins.set("probe",state.values.builtinFunction({name:"probe",invoke:(_args,_keywords,_meter,context)=>{
    const source=state.values.string("\ud800"),recovery=new RuntimeMultibyteRecovery(state.registry,source,context!);
    const result=recovery.recover(new PythonEncodeError(codec.name,source.value,0,1,"illegal multibyte sequence"),"ignore",()=>{throw Error("ignore must not encode a replacement");});
    expect(result.replacement).toEqual(new Uint8Array());
    expect(result.position).toBe(1n);
    return state.values.none;
  }}));
  state.run("probe()");
});

it.each(["unencodable","failure","cancel-return","cancel-throw"])("handles native replacement encoder outcome %s",outcome=>{
  const controller=new AbortController(),state=fixture(controller.signal),failure=new Error("replacement failure");
  state.builtins.set("probe",state.values.builtinFunction({name:"probe",invoke:(_args,_keywords,_meter,context)=>{
    const source=state.values.string("\ud800"),recovery=new RuntimeMultibyteRecovery(state.registry,source,context!);
    const run=()=>recovery.recover(new PythonEncodeError(codec.name,source.value,0,1,"illegal multibyte sequence"),"replace",replacement=>{
      expect([...replacement]).toEqual([63]);
      if(outcome==="unencodable")throw new PythonEncodeError(codec.name,replacement,0,1,"illegal multibyte sequence");
      if(outcome==="failure")throw failure;
      controller.abort();
      if(outcome==="cancel-throw")throw failure;
      return Uint8Array.of(63);
    });
    if(outcome==="unencodable")expect(run()).toEqual({replacement:Uint8Array.of(63),position:1n});
    else if(outcome==="failure")expect(run).toThrow(failure);
    else expect(run).toThrow(ExecutionLimitError);
    return state.values.none;
  }}));
  if(outcome.startsWith("cancel"))expect(()=>state.run("probe()")).toThrow(ExecutionLimitError);
  else state.run("probe()");
});

it.each(["encode","decode"])("rejects index-only resume positions without invocation during %s",operation=>{
  fixture().run(`
class Position:
    def __index__(self):
        raise AssertionError('index must not run')
def handler(error):
    return ('?', Position())
register_error('probe', handler)
try:
    gb${operation}(${operation==="encode"?"chr(55296)":"bad"}, 'probe')
except TypeError as error:
    assert error.args == ('${operation==="encode"?"encoding":"decoding"} error handler must return (str, int) tuple',)
else:
    assert False
`);
});

it.each(["encode","decode"])("rereads the registry and preserves cached exception mutations during %s",operation=>{
  fixture().run(`
seen = []
def second(error):
    assert error is seen[0]
    assert error.object is None
    assert error.encoding == 'mutated'
    assert error.args == ('retained',)
    assert (error.start, error.end, error.reason) == (1, 2, '${operation==="encode"?"illegal":trailingReason} multibyte sequence')
    return ('!', error.end)
def first(error):
    seen.append(error)
    error.object = None
    error.encoding = 'mutated'
    error.args = ('retained',)
    error.start = 500
    error.end = 600
    error.reason = 'mutated'
    register_error('probe', second)
    return ('?', 1)
register_error('probe', first)
assert gb${operation}(${operation==="encode"?"chr(55296) + chr(55297)":"(bad + bad)"}, 'probe') == ${operation==="encode"?"b'?!'":"'?!'"}
assert len(seen) == 1
`);
});

it.each(["encode","decode"])("uses original input and native subtype payloads for %s",operation=>{
  fixture().run(`
class Position(int):
    def __index__(self):
        raise AssertionError('index')
    def __int__(self):
        raise AssertionError('int')
class Text(str):
    def __str__(self):
        raise AssertionError('str')
class Result(tuple):
    def __getitem__(self, key):
        raise AssertionError('getitem')
    def __len__(self):
        raise AssertionError('len')
def handler(error):
    error.object = None
    return Result((Text('?'), Position(-1)))
register_error('probe', handler)
assert gb${operation}(${operation==="encode"?"chr(55296) + 'A'":"(bad + b'A')"}, 'probe') == ${operation==="encode"?"b'?A'":"'?A'"}
`);
});

it.each(["encode","decode"])("preserves guest callback failure identity during %s",operation=>{
  fixture().run(`
failure = ValueError('guest failure')
def handler(error):
    raise failure
register_error('probe', handler)
try:
    gb${operation}(${operation==="encode"?"chr(55296)":"bad"}, 'probe')
except ValueError as error:
    assert error is failure
else:
    assert False
`);
});

it.each([false,true])("cancellation remains fatal after a callback (throws=%s)",throws=>{
  const controller=new AbortController(),state=fixture(controller.signal);
  state.builtins.set("cancel",state.values.builtinFunction({name:"cancel",invoke:()=>{controller.abort();return state.values.none;}}));
  expect(()=>state.run(`
def handler(error):
    cancel()
    ${throws?"raise ValueError('guest failure')":"return ('?', 1)"}
register_error('probe', handler)
try:
    gbdecode(bad, 'probe')
except BaseException:
    pass
`)).toThrow(ExecutionLimitError);
});

it.each(["encode","decode"])("validates complete native callback result shapes during %s",operation=>{
  fixture().run(`
def handler(error):
    return result
register_error('probe', handler)
for result in [None, [], ('?',), ('?', 1, None), ['?', 1], ('?', None), ('?', 1.0), (None, 1), (b'?', 1)]:
    if ${operation==="encode"?"True":"False"} and result == (b'?', 1):
        assert gbencode(chr(55296), 'probe') == b'?'
        continue
    try:
        gb${operation}(${operation==="encode"?"chr(55296)":"bad"}, 'probe')
    except TypeError as error:
        assert error.args == ('${operation==="encode"?"encoding":"decoding"} error handler must return (str, int) tuple',)
    else:
        assert False
for result in [('?', True), ('?', -1)]:
    assert gb${operation}(${operation==="encode"?"chr(55296) + 'A'":"(bad + b'A')"}, 'probe') == ${operation==="encode"?"b'?A'":"'?A'"}
`);
});

it.each(["encode","decode"])("reports negative, positive and overflowing native %s positions",operation=>{
  fixture().run(`
def handler(error):
    return ('?', position)
register_error('probe', handler)
for position, reported in [(-3, -1), (3, 3), (1 << 63, -1), (-(1 << 63) - 1, -1)]:
    try:
        gb${operation}(${operation==="encode"?"chr(55296) + 'A'":"(bad + b'A')"}, 'probe')
    except IndexError as error:
        assert error.args == ('position ' + str(reported) + ' from error handler out of bounds',)
    else:
        assert False
`);
});

it("encodes text replacements before overflow conversion and preserves raw bytes subtype storage",()=>{
  fixture().run(`
class Raw(bytes):
    def __bytes__(self):
        raise AssertionError('bytes')
def handler(error):
    return (replacement, position)
register_error('probe', handler)
replacement = chr(55297)
position = 1 << 63
try:
    gbencode(chr(55296), 'probe')
except UnicodeEncodeError as error:
    assert error.object is replacement
    assert (error.start, error.end, error.reason, error.encoding) == (0, 1, 'illegal multibyte sequence', '${codec.name}')
else:
    assert False
replacement = Raw(bad)
position = 1
assert gbencode(chr(55296), 'probe') == bad
`);
});

it.each(["encode","decode"])("keeps reentrant %s exception caches independent",operation=>{
  fixture().run(`
seen = []
active = False
def handler(error):
    global active
    seen.append(error)
    if not active:
        active = True
        assert gb${operation}(${operation==="encode"?"chr(55297)":"nested_bad"}, 'probe') == ${operation==="encode"?"b'?'":"'?'"}
        active = False
    return ('?', error.end)
register_error('probe', handler)
assert gb${operation}(${operation==="encode"?"chr(55296) + chr(55296)":"(bad + bad)"}, 'probe') == ${operation==="encode"?"b'??'":"'??'"}
assert len(seen) == 4
assert seen[0] is seen[2]
assert seen[0] is not seen[1]
assert seen[0] is not seen[3]
assert seen[1] is not seen[3]
`);
});

it("uses pinned standard replacement handlers through the interpreter registry",()=>{
  fixture().run(`
assert gbencode(chr(55296), 'backslashreplace') == b'${escapedBackslash}ud800'
assert gbencode(chr(128512), 'xmlcharrefreplace') == ${supplementary??"b'&#128512;'"}
assert gbencode(chr(128512), 'namereplace') == ${supplementary??`b'${escapedBackslash}N{GRINNING FACE}'`}
assert gbdecode(bad, 'backslashreplace') == '\\\\x${invalid.toString(16)}'
assert gbdecode(bad, 'surrogateescape') == chr(${0xdc00+invalid})
assert gbencode(chr(${0xdc00+invalid}), 'surrogateescape') == bad
`);
});

if(shiftProbe!==undefined)it("encodes guest replacement text in the active shift state",()=>{
  fixture().run(`
def handler(error):
    return ('・', -1)
register_error('probe', handler)
assert gbencode('中😀文', 'probe') == b'${shiftProbe}'
`);
});

});
