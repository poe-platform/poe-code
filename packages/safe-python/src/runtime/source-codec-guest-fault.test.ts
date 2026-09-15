import {expect,it} from "vitest";
import {sourceCodecGuestFaultCases} from "../source-codec-guest-fault-cases.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {RuntimeExecutionKeys} from "./runtime-execution-keys.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";
import {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {createRuntimeCompilation} from "./runtime-compilation.js";
import {createRuntimeDynamicExecution} from "./runtime-dynamic-execution.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {compileSourceProgram} from "./source-program-compilation.js";
import {standardExceptionCatalog,type StandardExceptionName} from "./standard-exception-catalog.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

function runCase(source:string,mode:string,options:{signal?:AbortSignal;service?:()=>void;input?:Uint8Array;decoded?:string}={}){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000,signal:options.signal});
  const values=new RuntimeValues(meter),calls=new CallStack<object>(100,meter);
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys=new RuntimeExecutionKeys(values,hash,meter,calls);
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter);
  const globals=new Map<string,RuntimeValue>(),programs=new RuntimeCodePrograms(meter,values);
  const unused=():never=>{throw Error("unexpected service");};
  const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unused,lookupWrite:unused,flush:unused}});
  for(const name of Object.keys(standardExceptionCatalog) as StandardExceptionName[])builtins.set(name,types.exceptionType(name));
  for(const [name,value] of Object.entries({object:types.object,type:types.type,str:types.stringType(),int:types.integerType(),tuple:types.tupleType(),super:types.superType()}))builtins.set(name,value);
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unused}),statements:()=>({setAttribute:unused,deleteAttribute:unused,executeUnhandled:unused}),callable:()=>false,invoke:unused,name:()=>"function()",
    keywordName:value=>{if(value.kind!=="str")return unused();return String.fromCodePoint(...value.value);},
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unused()})
  }};
  builtins.set("service",values.builtinFunction({name:"service",invoke(){options.service?.();return values.none;}}));
  globals.set("__name__",values.string("__main__"));
  const target=values.string(mode==="compile"?"guest-codec.py":"<string>","fresh");
  globals.set("target",target);
  globals.set("preserve_filename",values.boolean(mode==="compile"));
  builtins.set("trigger",values.builtinFunction({name:"trigger",invoke(_args,_kwargs,_meter,invocation){
    const codecs=new RuntimeCodecRegistry(values,meter);
    const callback=values.builtinFunction({name:"decoder",invoke(){invocation!.call(globals.get("decode")!,[]);throw Error("decoder unexpectedly returned");}});
    const info=values.tuple([values.none,callback,values.none,values.none]);
    codecs.register(values.builtinFunction({name:"search",invoke:()=>info}),invocation!);
    const compilation=()=>({stripDocstring:false,enterRecursiveCall:()=>calls.enter({}),decodeSource:(encoding:string,source:Uint8Array)=>{
      if(options.decoded!==undefined)return options.decoded;
      codecs.transform("decode",values.bytes(source),encoding,undefined,invocation!);
      throw Error("decoder unexpectedly returned");
    }});
    const input=values.bytes(options.input??Uint8Array.from(Array.from("# coding: guest-fault\n1",character=>character.charCodeAt(0))));
    if(mode==="compile")return createRuntimeCompilation(values,programs,{compilation,code:types.code.bind(types)}).compile({source:input,filename:{displayName:"guest-codec.py",value:target},mode:"exec",flags:0,optimize:-1,featureVersion:-1},invocation,meter);
    const namespace=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
    return createRuntimeDynamicExecution(context,programs,{compilation,globals:()=>namespace,locals:()=>namespace,builtins:()=>namespace}).execute({mode:mode as "exec"|"eval",source:input,globals:namespace,locals:namespace,closure:values.none},invocation,meter);
  }}));
  let failure:unknown;
  try{executeRuntimeProgram(compileSourceProgram(source,{stripDocstring:false,enterRecursiveCall:()=>calls.enter({})},values,meter),context,meter);}
  catch(error){failure=error instanceof RuntimeRaisedException?{type:error.value.type.value.name,args:runtimeExceptionPayload(error.value)?.args.items}:error;}
  return {failure,meter};
}

it.each(sourceCodecGuestFaultCases.flatMap(row=>["compile","exec","eval"].map(mode=>({...row,mode}))))("source codec guest fault: $mode / $name",({source,mode})=>{
  expect(runCase(source,mode).failure).toBeUndefined();
});

it.each(["compile","exec","eval"])("retains native tokenizer filename identity for %s",mode=>{
  expect(runCase(`
def decode():
    raise AssertionError('explicit decoder result')
try:
    trigger()
except SyntaxError as error:
    assert error.args == ('invalid non-printable character U+FEFF', (target, 1, 1, '\\ufeff1', 1, 1))
    assert error.msg is error.args[0]
    assert error.filename == target
    if preserve_filename:
        assert error.args[1][0] is target
        assert error.filename is target
else:
    assert False
`,mode,{decoded:"\ufeff1"}).failure).toBeUndefined();
});

it.each(["decode","str","repr","filename"].flatMap(phase=>["return","throw","fatal","fatal-abort"].map(outcome=>({phase,outcome}))))("source codec cancellation during $phase ($outcome)",({phase,outcome})=>{
  const controller=new AbortController(),fatal=new ExecutionLimitError("allocation");let calls=0;
  const operation=phase==="decode"?"service(); raise ValueError('decode')":"raise failure";
  const definition=phase==="str"?"class Failure(ValueError):\n    def __str__(self):\n        service()\n        return 'rendered'\nfailure = Failure('before')"
    :phase==="repr"?"class Key:\n    def __repr__(self):\n        service()\n        return 'key'\nfailure = KeyError(Key())"
      :phase==="filename"?"class Failure(SyntaxError):\n    def __setattr__(self, name, value):\n        if name == 'filename':\n            service()\n        super().__setattr__(name, value)\nfailure = Failure('before')":"";
  const result=runCase(`${definition}\ndef decode():\n    ${operation}\ntry:\n    trigger()\nexcept BaseException:\n    raise AssertionError('cancellation became catchable')\n`,"compile",{signal:controller.signal,service(){
    calls++;
    if(outcome==="fatal")throw fatal;
    if(outcome==="fatal-abort"){controller.abort();throw fatal;}
    controller.abort();
    if(outcome==="throw")throw Error("service failed after cancellation");
  }});
  expect(result.failure).toBeInstanceOf(ExecutionLimitError);
  expect(calls).toBe(1);
  if(outcome==="fatal"||outcome==="fatal-abort")expect(result.failure).toBe(fatal);
  else expect(()=>result.meter.checkpoint()).toThrow(result.failure as Error);
});
