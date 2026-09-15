import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {codecPublicContractCases} from "./codec-public-contract-cases.js";
import reference from "./runtime/__snapshots__/codec-public-edge-review-3.14.7.json" with {type:"json"};

it.each(codecPublicContractCases)("public codec contract: $name",({name,source})=>{
  const expected=reference.cases.find(row=>row.name===name);
  expect(expected).toBeDefined();
  expect(expected!.source).toBe(source);
  expect(expected!.status).toBe(0);
  expect(expected!.signal).toBeNull();
  let output="";
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],
    output:{write(text){output+=text;},flush(){}}
  });
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("contract_error",result.exception);
    const diagnostic=session.eval("str(contract_error)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
  expect(output).toBe(expected!.stdout);
});
