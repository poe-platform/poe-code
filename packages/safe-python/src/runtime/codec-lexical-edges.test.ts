import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";
import {decodeUtf7} from "./utf7.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";

interface Sample {
  errors:Utf8DecodeErrors;
  final:boolean;
  raw?:boolean;
  warnings?:string[];
  result?:[number[],number];
  error?:[string,number[],number,number,string];
}
interface Corpus {
  oracle:{version:string;platform:string;byteorder:string;unicode:string};
  utf7:{input:number[];cases:Sample[]}[];
  escape:{input:number[];cases:Sample[]}[];
}
const reference=JSON.parse(readFileSync(new URL("./__snapshots__/codec-lexical-edges-3.14.7.json",import.meta.url),"utf8")) as Corpus;

// Captured from the external pinned oracle; tests execute only real kernels.
// Public imports, warning categories/filters and guest tracebacks have separate
// acceptance tests and are not established by these kernel-level observations.
it("pins the lexical edge corpus to the required reference platform",()=>{
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.platform).toBe("darwin");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.utf7.reduce((count,row)=>count+row.cases.length,0)).toBe(40000);
  expect(reference.escape.reduce((count,row)=>count+row.cases.length,0)).toBe(32000);
});

for(const family of ["utf7","escape"] as const){
  it.each(reference[family])(`${family} preserves lexical recovery and finality for $input`,row=>{
    for(const sample of row.cases){
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const warnings:string[]=[];
      let actual:unknown;
      try{
        const input=Uint8Array.from(row.input),errors=sample.errors;
        const decoded=sample.raw!==undefined
          ?decodeUnicodeEscape(input,sample.raw,errors,meter,sample.final,message=>warnings.push(message))
          :decodeUtf7(input,errors,meter,sample.final);
        actual={result:[[...decoded.text],decoded.consumed]};
      }catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason]};
      }
      expect(actual,JSON.stringify(sample)).toEqual(sample.result!==undefined?{result:sample.result}:{error:sample.error});
      expect(warnings,JSON.stringify(sample)).toEqual(sample.warnings??[]);
    }
  });
}
