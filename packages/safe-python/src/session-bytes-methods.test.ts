import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import rows from "./runtime/__snapshots__/bytes-methods-3.14.7.json";

it.each(rows)('executes native bytes.$name through the public session',({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(`result = ${source}`).status).toBe('ok');
  expect(session.eval('repr((type(result).__name__, repr(result)))')).toMatchObject({status:'ok',value:{kind:'str',primitive:expected}});
});
