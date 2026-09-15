import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {textSubtypeStorageCases} from "./codec-text-subtype-storage-cases.js";
import reference from "./runtime/__snapshots__/codec-text-subtype-storage-evidence.json";

it.each(textSubtypeStorageCases)("text conversion retains native subtype storage: $name",({name,source})=>{
  const expected=reference.cases.find(row=>row.name===name)!;
  expect(expected.source).toBe(source);
  expect(expected.oracle).toEqual({status:0,stdout:"",stderr:""});
  expect(reference.metadata.stdout).toContain("3.14.7");
  expect(reference.metadata.stdout).toContain("16.0.0\ndarwin little");
  const session=new PythonSession({hashSeed:[1n,2n],limits:{maxSteps:300000,maxAllocatedBytes:8000000,maxDepth:100}});
  const result=session.exec(source);
  expect(result.status).toBe("ok");
});
