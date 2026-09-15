import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-user-edge-cases-3.14.7.json";

it.each(reference.rows)("matches bytes user edge cases: $name",({source,expected})=>{
  const writes:string[]=[];
  const session=new PythonSession({
    limits:{maxSteps:4_000_000,maxAllocatedBytes:32_000_000,maxDepth:100},
    hashSeed:[1n,2n],
    output:{write(text){writes.push(text);},flush(){}}
  });
  expect(session.exec(source)).toEqual({status:"ok"});
  expect(writes.join("")).toBe(expected);
});
