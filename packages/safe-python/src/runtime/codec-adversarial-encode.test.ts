import {expect,it} from "vitest";
import reference from "./__snapshots__/codec-adversarial-encode-3.14.7.json";
import {unicodeCodecName} from "../unicode-codec-name.js";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import {encodeWideUnicode} from "./utf-wide.js";
import {encodeUtf7} from "./utf7.js";
import {encodeUtf8,type Utf8EncodeErrors} from "./utf8-encode.js";
import {encodeUtf8Signature} from "./utf8-signature.js";

it("pins the adversarial encoding oracle and retains every captured case",()=>{
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.inputs).toHaveLength(96);
  expect(reference.groups).toHaveLength(80);
  for(const group of reference.groups)expect(group.cases).toHaveLength(reference.inputs.length);
  expect(reference.utf7).toHaveLength(1474);
});

// All expectations were captured externally; replay uses the actual kernels
// and pinned Unicode names without host codecs, processes or filesystem I/O.
it.each(reference.groups)("adversarial encoding $encoding / $errors",group=>{
  const {encoding}=group,errors=group.errors as Utf8EncodeErrors;
  for(const [index,row] of group.cases.entries()){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    const input=new CodePointString(Uint32Array.from(reference.inputs[index]),meter);
    let actual:Record<string,unknown>;
    try{
      const output=encoding==="ascii"||encoding==="latin-1"?encodeSingleByte(input,encoding,errors,meter,point=>unicodeCodecName(point,meter)):
        encoding==="utf-8"?encodeUtf8(input,errors,meter):
        encoding==="utf-8-sig"?encodeUtf8Signature(input,errors,meter):
        encodeWideUnicode(input,encoding.startsWith("utf-16")?16:32,encoding.endsWith("le")?-1:encoding.endsWith("be")?1:0,errors,meter);
      actual={bytes:[...output]};
    }catch(error){
      if(!(error instanceof PythonEncodeError))throw error;
      actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason],message:error.message};
    }
    expect(actual,JSON.stringify(reference.inputs[index])).toEqual(row);
  }
});

it("matches UTF-7 direct and shifted transitions including adjacent surrogate code points",()=>{
  for(const row of reference.utf7){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    const input=new CodePointString(Uint32Array.from(row.input),meter);
    expect([...encodeUtf7(input,meter)],JSON.stringify(row.input)).toEqual(row.bytes);
  }
});
