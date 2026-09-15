import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/set-union-cached-hash-3.14.7.json";

it.each(reference.rows)("matches cached native set/union hash comparison: $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:2000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source)).toEqual({status:"ok"});
  expect(session.eval("repr(result)")).toMatchObject({status:"ok",value:{primitive:expected}});
});
