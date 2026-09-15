import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/escape-text-consumers-3.14.7.json";

it.each(reference.cases)("public escape decoding with a real warning service: $name / $policy",row=>{
  const warnings:string[][]=[];
  const session=new PythonSession({limits:{maxSteps:2000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],warning:warning=>{
    warnings.push([warning.category,warning.message]);
    expect(warning.filename).toBe("unicode-codecs.py");
  }});
  expect(session.exec(row.source,{filename:"unicode-codecs.py"}).status).toBe("ok");
  expect(warnings).toEqual(row.warnings);
});
