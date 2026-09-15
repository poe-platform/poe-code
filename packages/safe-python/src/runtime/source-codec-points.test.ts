import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {PythonSyntaxError} from "../source.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";
import reference from "./__snapshots__/source-codec-points-3.14.7.json";

const constants={string:(value:string)=>value,integer:(value:number)=>value,tuple:(values:readonly unknown[])=>values};

it.each(reference.cases)("lossless source codec result: $name",({input,expected})=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  let actual:unknown;
  try {
    const program=compileSourceProgram(Uint8Array.from(input),{
      filename:"points.py",stripDocstring:false,enterRecursiveCall:()=>()=>{},
      decodeSource:(encoding,bytes,meter)=>{
        expect(encoding).toBe("source-points");
        return decodeUnicodeEscape(bytes.subarray(bytes.indexOf(10)+1),true,"strict",meter,true,()=>{throw Error("unexpected raw escape warning");}).text;
      }
    },constants,meter);
    actual={docstring:program.module.docstring?.value??null};
  } catch(error){
    if(!(error instanceof PythonSyntaxError))throw error;
    expect(error.filename).toBe("points.py");
    actual={error:{message:error.message,line:error.position.line,column:error.position.column,
      endLine:error.endPosition?.line??null,endColumn:error.endPosition?.column??null,sourceLine:error.sourceLine??null}};
  }
  expect(actual).toEqual(expected);
});

it.each([false,true])("lossless source codec cancellation is terminal (throws=%s)",throws=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const input=Uint8Array.from(reference.cases.find(row=>row.name==="high-low")!.input);
  expect(()=>compileSourceProgram(input,{
    stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:(_encoding,bytes,meter)=>{
      const decoded=decodeUnicodeEscape(bytes.subarray(bytes.indexOf(10)+1),true,"strict",meter,true,()=>{throw Error("unexpected raw escape warning");}).text;
      controller.abort();
      if(throws)throw Error("decoder failure");
      return decoded;
    }
  },constants,meter)).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});
