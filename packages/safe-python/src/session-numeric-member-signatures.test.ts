import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/numeric-member-signatures-3.14.7.json";

it.each(reference.cases)("publishes and executes the pinned numeric descriptor $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  expect(result.status).toBe("ok");
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{primitive:expected}});
});
