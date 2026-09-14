import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-method-binding-3.14.7.json";

it.each(reference.rows)("matches pinned bytes method binding: $source",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`
${reference.setup}
try:
    result = ${source}
    actual = (type(result).__name__, repr(result))
except BaseException as error:
    actual = (type(error).__name__, str(error))
`);
  expect(result.status).toBe("ok");
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{kind:"str",primitive:expected}});
});

it.each(reference.programs)("matches pinned bytes callback behavior: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let diagnostic:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    diagnostic=session.eval("repr(failure)");
  }
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==="bigint"?String(value):value)).toBe("ok");
});
