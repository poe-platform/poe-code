import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/float-fromhex-subtypes-3.14.7.json";

it.each(reference.cases)("preserves native hexadecimal text and subtype construction: $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source).status).toBe("ok");
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{primitive:expected}});
});
