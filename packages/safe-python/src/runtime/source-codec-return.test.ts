import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {PythonSyntaxError} from "../source.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import reference from "./__snapshots__/source-codec-return-3.14.7.json";

const input=new TextEncoder().encode("# coding: source-return\nignored");
const constants={string:(value:string)=>value,integer:(value:number)=>value,tuple:(values:readonly unknown[])=>values};

it.each(reference.cases)("source decoder returned text $name",({decoded,expected})=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  let actual:unknown;
  try {
    const program=compileSourceProgram(input,{filename:"returned.py",stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:()=>decoded},constants,meter);
    actual={docstring:program.module.docstring?.value??null};
  } catch(error){
    if(!(error instanceof PythonSyntaxError))throw error;
    expect(error.filename).toBe("returned.py");
    actual={error:{message:error.message,line:error.position.line,column:error.position.column,
      endLine:error.endPosition?.line??null,endColumn:error.endPosition?.column??null,sourceLine:error.sourceLine??null}};
  }
  expect(actual).toEqual(expected);
});

it.each([false,true])("source decoder cancellation precedes returned-text validation (throws=%s)",throws=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>compileSourceProgram(input,{stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:()=>{
    controller.abort();
    if(throws)throw new Error("decoder failed");
    return "\ufeff\0\ud800";
  }},constants,meter)).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});
