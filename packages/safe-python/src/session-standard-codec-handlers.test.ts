import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {standardCodecHandlerCases} from "./standard-codec-handler-cases.js";

// Kernel fixtures alone cannot certify public handler compatibility.
it.each(standardCodecHandlerCases)("public standard handler: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:2000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const diagnostic=session.eval("str(globals().get('row_index')) + ': ' + type(failure).__name__ + ': ' + str(failure)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail??(result.status==="terminated"?result.message:undefined)).toBe("ok");
});
