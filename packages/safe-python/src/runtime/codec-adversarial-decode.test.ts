import {expect,it} from "vitest";
import reference from "./__snapshots__/codec-adversarial-decode-3.14.7.json";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";
import {decodeWideUnicode} from "./utf-wide.js";
import {decodeUtf7} from "./utf7.js";
import {decodeUtf8,type Utf8DecodeErrors} from "./utf8-decode.js";

it("pins the adversarial decoding oracle and retains the complete captured corpus",()=>{
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.groups.reduce((count,group)=>count+group.cases.length,0)).toBe(15640);
});

// Oracle capture is external. Replay invokes only real, metered codec kernels;
// neither a host codec nor a subprocess supplies runtime/test results.
it.each(reference.groups)("adversarial $encoding / $errors / final=$final",group=>{
  const {encoding,final}=group,errors=group.errors as Utf8DecodeErrors;
  for(const row of group.cases){
    const input=Uint8Array.from(row.input),warnings:string[]=[];
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    const escape=encoding==="unicode-escape"||encoding==="raw-unicode-escape";
    let actual:Record<string,unknown>;
    try{
      const result=escape?decodeUnicodeEscape(input,encoding==="raw-unicode-escape",errors,meter,final,message=>warnings.push(message)):
        encoding==="utf-7"?decodeUtf7(input,errors,meter,final):
        encoding==="utf-8"?decodeUtf8(input,errors,meter,final):
        decodeWideUnicode(input,encoding.startsWith("utf-16")?16:32,encoding.endsWith("le")?-1:encoding.endsWith("be")?1:0,errors,meter,final);
      actual={text:[...result.text],consumed:result.consumed};
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason]};
    }
    if(escape)actual.warnings=warnings;
    expect(actual,JSON.stringify(row.input)).toEqual(row.expected);
  }
});
