import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import reference from "./__snapshots__/newline-three-chunk-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {UniversalNewlineDecoder} from "./newline-decoder.js";
import {RuntimeValues} from "./runtime-values.js";
import {ExecutionBudget} from "./execution-budget.js";

it.each(reference.groups)("matches pinned newline partitions: translate=$translate first=$first",group=>{
  expect(reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.unicode).toBe("16.0.0");
  expect(reference.platform).toBe("darwin");
  expect(reference.byteorder).toBe("little");
  const records:unknown[]=[];
  for(const second of reference.alphabet)for(const third of reference.alphabet){
    const points=[group.first,second,third];
    for(let left=0;left<=3;left++)for(let right=left;right<=3;right++){
      const decoder=new UniversalNewlineDecoder(group.translate);
      const values=new RuntimeValues(new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}));
      const chunks=[points.slice(0,left),points.slice(left,right),points.slice(right),[],[]];
      records.push(chunks.map((chunk,index)=>{
        const source=new CodePointString(Uint32Array.from(chunk));
        const result=decoder.decode(source,index>=3);
        // Exact Python strings include empty/Latin-1 singleton publication.
        // Raw code-point storage identity alone cannot represent that contract.
        const input=values.stringPoints(source,"canonical");
        const output=result===source?input:values.stringPoints(result,"canonical");
        return [[...result],Number(decoder.getstate().pendingCR),decoder.newlines,output===input];
      }));
    }
  }
  expect(records).toHaveLength(group.count);
  expect(createHash("sha256").update(JSON.stringify(records)).digest("hex")).toBe(group.sha256);
});
