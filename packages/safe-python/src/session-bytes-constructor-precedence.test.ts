import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-constructor-precedence-3.14.7.json";

it.each(reference.rows)("matches constructor argument precedence: $source",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`
try:
    result = ${source}
    actual = (type(result).__name__, repr(result))
except BaseException as error:
    actual = (type(error).__name__, str(error))
`);
  expect(result.status).toBe("ok");
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{kind:"str",primitive:expected}});
});
