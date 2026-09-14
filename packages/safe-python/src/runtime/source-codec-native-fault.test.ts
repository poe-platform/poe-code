import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {PythonSyntaxError} from "../source.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues} from "./runtime-values.js";
import reference from "./__snapshots__/source-codec-native-fault-3.14.7.json";

const input=Uint8Array.from(Array.from("# coding: native-fault\n1",character=>character.charCodeAt(0)));
const constants={string:(value:string)=>value,integer:(value:number)=>value,tuple:(values:readonly unknown[])=>values};

it.each(reference.cases)("native source fault $name / $message / $mode",({name,message,mode,expected})=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const fault=new PythonRuntimeError((name==="handler"?"LookupError":name) as ConstructorParameters<typeof PythonRuntimeError>[0],message??undefined);
  let actual:unknown;
  try {
    compileSourceProgram(input,{filename:"native-fault.py",mode:mode as "exec"|"eval",stripDocstring:false,
      enterRecursiveCall:()=>()=>{},decodeSource:()=>{
        if(name==="handler")new RuntimeCodecRegistry(new RuntimeValues(meter),meter).lookupError(message!);
        throw fault;
      }
    },constants,meter);
  } catch(error){
    if(error instanceof PythonSyntaxError){
      actual={type:error.name,message:error.message,filename:error.filename,line:error.position.line,column:error.position.column,
        endLine:error.endPosition?.line??null,endColumn:error.endPosition?.column??null,text:error.sourceLine??null};
    }else{
      if(name!=="handler")expect(error).toBe(fault);
      expect(error).toBeInstanceOf(PythonRuntimeError);
      const native=error as PythonRuntimeError;
      actual={type:native.name,message:native.message};
    }
  }
  expect(actual).toEqual(expected);
});

it("does not classify an ambient Error by its name",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const fault=new Error("host failure");fault.name="ValueError";
  expect(()=>compileSourceProgram(input,{stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:()=>{throw fault;}},constants,meter)).toThrow(fault);
});

it.each(["ValueError","UnicodeError","LookupError","IndexError","KeyError"] as const)("keeps cancellation terminal during %s source failure",name=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>compileSourceProgram(input,{stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:()=>{
    controller.abort();throw new PythonRuntimeError(name,"fault");
  }},constants,meter)).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});
