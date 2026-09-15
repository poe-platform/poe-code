import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-fromhex-reservation-3.14.7.json";

it.each(reference.rows)("preserves bytes.fromhex writer identity: $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source)).toEqual({status:"ok"});
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{kind:"str",primitive:expected}});
});
