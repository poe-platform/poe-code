import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";
import reference from "./__snapshots__/qp-native-binding-3.14.7.json";
import audit from "./__snapshots__/quoted-printable-native-binding-3.14.7.json";

// Compile actual guest classes and callbacks against the native bindings.
// Public binascii publication and guest buffer exporters remain separate work.
function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:500000,maxAllocatedBytes:8000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>();
  const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter);
  globals.set("__name__",values.string("__main__"));
  const unavailable=():never=>{throw Error("unavailable test capability");};
  const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unavailable,lookupWrite:unavailable,flush:unavailable}});
  for(const name of ["BaseException","ValueError","TypeError","AssertionError"] as const)builtins.set(name,types.exceptionType(name));
  for(const [name,value] of Object.entries({object:types.object,type:types.type,str:types.stringType(),bytes:types.bytesType(),int:types.integerType()}))builtins.set(name,value);
  const text=(value:RuntimeValue)=>{if(value.kind!=="str")return unavailable();return [...value.value].map(point=>String.fromCodePoint(point)).join("");};
  for(const [name,value] of createRuntimeQuotedPrintableFunctions(values,meter))builtins.set(name,value);
  builtins.set("cancel",values.builtinFunction({name:"cancel",invoke(){controller.abort();return values.none;}}));
  const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
    expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
    callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
    specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
  }};
  return (source:string)=>{
    try{return executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source),{stripDocstring:false},values,meter),context,meter);}
    catch(error){
      if(error instanceof RuntimeRaisedException)throw new Error(error.value.type.value.name+": "+JSON.stringify(runtimeExceptionPayload(error.value)?.args.items.map(value=>value.kind==="str"?text(value):value.kind)));
      throw error;
    }
  };
}

it.each(reference.sources.map((source,index)=>({source,index})))("replays unchanged pinned quoted-printable guest program $index",({source})=>{
  fixture()(source);
});

it.each(audit.sources.map((source,index)=>({source,index})))("replays quoted-printable option order and failure audit $index",({source})=>{
  fixture()(source);
});

it.each(["__bool__","__len__"])("keeps quoted-printable guest cancellation in %s terminal",method=>{
  for(const throws of [false,true]){
    const run=fixture();
    expect(()=>run(`
class Flag:
    def ${method}(self):
        cancel()
        ${throws?"raise ValueError('cancelled truth')":method==="__bool__"?"return False":"return 0"}
try:
    b2a_qp(b'', header=Flag())
except BaseException:
    raise AssertionError('cancellation was catchable')
`)).toThrow(ExecutionLimitError);
    expect(()=>run("1")).toThrow(ExecutionLimitError);
  }
});
