import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {wideCodecResultCases} from "./wide-codec-result-cases.js";

it.each(wideCodecResultCases)("public wide codec results: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:3000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const message=session.eval("str(failure)");
    if(message.status==="ok")detail=String(message.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});
