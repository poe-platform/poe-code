import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {PythonSyntaxError} from "../source.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";
import {encodeUtf8} from "./utf8-encode.js";
import {decodeUtf8} from "./utf8-decode.js";
import type {SourceByteDecoder} from "./byte-source-decoding.js";
import reference from "./__snapshots__/source-codec-encode-fault-3.14.7.json";

const constants={string:(value:string)=>value,integer:(value:number)=>value,tuple:(values:readonly unknown[])=>values};
const decode:SourceByteDecoder=(encoding,bytes,meter)=>{
  expect(encoding).toBe("source-encode-fault");
  const text=decodeUnicodeEscape(bytes.subarray(bytes.indexOf(10)+1),true,"strict",meter,true,()=>{throw Error("unexpected raw escape warning");}).text;
  return decodeUtf8(encodeUtf8(text,"strict",meter),"strict",meter).text;
};

it.each(reference.cases)("source decoder encoding failure: $name",({mode,input,expected})=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  let actual:unknown;
  try {
    const program=compileSourceProgram(Uint8Array.from(input),{
      filename:"encode-fault.py",mode:mode as "exec"|"eval",stripDocstring:false,
      enterRecursiveCall:()=>()=>{},decodeSource:decode
    },constants,meter);
    const expression=program.module.expression;
    if(mode==="eval")expect(expression?.kind).toBe("literal");
    actual={value:mode==="exec"?program.module.docstring?.value:expression?.kind==="literal"&&expression.value instanceof Uint32Array?String.fromCodePoint(...expression.value):undefined};
  }catch(error){
    if(!(error instanceof PythonSyntaxError))throw error;
    expect(error.filename).toBe("encode-fault.py");
    actual={error:{message:error.message,line:error.position.line,column:error.position.column,
      endLine:error.endPosition?.line??null,endColumn:error.endPosition?.column??null,sourceLine:error.sourceLine??null}};
  }
  expect(actual).toEqual(expected);
});

it("keeps cancellation terminal when a source decoder raises an encoding error",()=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const input=Uint8Array.from(reference.cases.find(row=>row.name==="pair exec")!.input);
  expect(()=>compileSourceProgram(input,{
    stripDocstring:false,enterRecursiveCall:()=>()=>{},decodeSource:(encoding,bytes,meter)=>{
      try{return decode(encoding,bytes,meter);}finally{controller.abort();}
    }
  },constants,meter)).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});
