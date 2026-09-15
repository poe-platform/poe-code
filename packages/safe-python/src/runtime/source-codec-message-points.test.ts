import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {compileSourceProgram} from "./source-program-compilation.js";
import {PythonUnicodeMessageError} from "./unicode-message-error.js";
import reference from "./__snapshots__/source-codec-message-points-3.14.7.json";

const input=Uint8Array.from(Array.from("# coding: point-fault\n1",character=>character.charCodeAt(0)));

it.each(reference.rows)("source codec diagnostic points: $name / $index / $mode",({name,points,mode,expected})=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),values=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const exceptions=new RuntimeExceptionExecution(new RuntimeTypeRegistry(values,keys,meter),values,meter);
  const fault=new PythonUnicodeMessageError(name as ConstructorParameters<typeof PythonUnicodeMessageError>[0],new CodePointString(Uint32Array.from(points),meter),meter);
  let caught:unknown;
  try {
    compileSourceProgram(input,{filename:"point-fault.py",mode:mode as "exec"|"eval",stripDocstring:false,
      enterRecursiveCall:()=>()=>{},decodeSource:()=>{throw fault;}
    },values,meter);
  }catch(error){caught=error;}
  expect(caught).toBeDefined();
  const prepared=exceptions.prepare(caught);
  expect(prepared).toBeInstanceOf(RuntimeRaisedException);
  if(!(prepared instanceof RuntimeRaisedException))throw prepared;
  const state=runtimeExceptionPayload(prepared.value)!;
  const message=state.args.items[0];
  if(message.kind!=="str")throw Error("expected string argument");
  const actual:Record<string,unknown>={type:prepared.value.type.value.name,points:[...message.value],same:caught===fault};
  if(expected.type==="SyntaxError"){
    const member=(key:string)=>{
      const value=state.member(key,meter)!;
      if(value.kind==="str")return String.fromCodePoint(...value.value);
      if(value.kind==="int")return Number(value.value);
      if(value.kind==="none")return null;
      throw Error("unexpected syntax error field");
    };
    Object.assign(actual,{filename:member("filename"),line:member("lineno"),offset:member("offset"),text:member("text"),msgAlias:state.member("msg",meter)===message});
  }
  expect(actual).toEqual(expected);
});

it.each(["ValueError","KeyError","TypeError"] as const)("keeps cancellation terminal before translating lossless %s diagnostics",name=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const fault=new PythonUnicodeMessageError(name,new CodePointString(Uint32Array.of(0xd800,0xdc00),meter),meter);
  expect(()=>compileSourceProgram(input,{stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:()=>{
    controller.abort();throw fault;
  }},values,meter)).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});
