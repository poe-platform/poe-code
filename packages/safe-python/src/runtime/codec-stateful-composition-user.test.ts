import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import reference from "./__snapshots__/codec-stateful-composition-user-3.14.7.json" with {type:"json"};
import {ExecutionBudget} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";
import {hzCodec} from "./hz-codec.js";

const codecs=new Map([iso2022KrCodec,iso2022JpCodec,iso2022Jp1Codec,iso2022Jp2Codec,iso2022JpExtCodec,hzCodec].map(codec=>[codec.name,codec]));

it("pins the complete composition corpus to the requested reference",()=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(reference.inputs).toHaveLength(1500);
  expect(reference.cases).toHaveLength(18);
  expect(new Set(reference.cases.map(row=>row.name))).toEqual(new Set(codecs.keys()));
});

it.each(reference.cases)("matches composed shifts, designations and recovery: $name/$errors",row=>{
  const codec=codecs.get(row.name)!;
  const policy=row.errors;
  if(policy!=="strict"&&policy!=="replace"&&policy!=="ignore")throw Error("invalid reference policy");
  const hash=createHash("sha256");
  for(const bytes of reference.inputs){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    let actual:unknown;
    try{
      const decoded=codec.decode(Uint8Array.from(bytes),policy,meter);
      actual=["ok",[...decoded.text],decoded.consumed];
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      actual=["error",error.start,error.end,error.reason];
    }
    hash.update(JSON.stringify(actual)+"\n");
  }
  expect(reference.inputs).toHaveLength(row.count);
  expect(hash.digest("hex")).toBe(row.sha256);
});
