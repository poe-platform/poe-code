import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import reference from "./__snapshots__/unicode-escape-byte-edge-audit.json";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";

it("matches the pinned escape byte matrix across raw/final flags and recovery policies",()=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(reference.mismatches).toEqual([]);
  const hash=createHash("sha256"),generator=reference.generator;
  let seed=generator.seed,count=0;
  for(let index=0;index<generator.count;index++){
    const bytes:number[]=[];
    for(let offset=0;offset<index%generator.lengthModulo;offset++){
      seed=(Math.imul(seed,generator.multiplier)+generator.increment)>>>0;
      bytes.push(generator.alphabet[seed%generator.alphabet.length]);
    }
    for(const raw of [false,true])for(const final of [false,true])for(const errors of ["strict","ignore","replace","backslashreplace"] as const){
      const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
      const warnings:string[]=[];
      let actual:Record<string,unknown>;
      try {
        const result=decodeUnicodeEscape(Uint8Array.from(bytes),raw,errors,meter,final,message=>warnings.push(message));
        actual={result:[[...result.text],result.consumed]};
      }catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason]};
      }
      actual.warnings=warnings;
      hash.update(JSON.stringify([{bytes,raw,final,errors},actual])+"\n");
      count++;
    }
  }
  expect(count).toBe(16000);
  expect(count).toBe(reference.caseCount);
  expect(hash.digest("hex")).toBe(reference.resultSha256);
});
