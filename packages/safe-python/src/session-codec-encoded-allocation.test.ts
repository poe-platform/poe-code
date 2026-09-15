import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {codecEncodedAllocationCases} from "./codec-encoded-allocation-cases.js";

it.each(codecEncodedAllocationCases)("encoded allocation: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:8000000,maxAllocatedBytes:128000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const diagnostic=session.eval("str(failure)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail??JSON.stringify(result)).toBe("ok");
});
