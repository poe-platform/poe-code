import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {osErrorCases,osErrorServiceCases} from "./os-error-cases.js";
import reference from "./runtime/__snapshots__/os-error-3.14.7.json" with {type:"json"};

it.each(osErrorCases)("OSError public contract: $name",({name,source})=>{
  const expected=reference.cases.find(row=>row.name===name)!;
  expect(expected.source).toBe(source);
  expect(expected.status).toBe(0);
  expect(expected.stderr).toBe("");
  let output="";
  const session=new PythonSession({limits:{maxSteps:2000000,maxAllocatedBytes:24000000,maxDepth:100},hashSeed:[1n,2n],output:{write(text){output+=text;},flush(){}}});
  const result=session.exec(source);
  let detail:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    detail=session.eval("str(failure)");
  }
  expect(result.status,JSON.stringify(detail)).toBe("ok");
  expect(output).toBe(expected.stdout);
});

it.each(osErrorServiceCases)("OSError service protocol: $name",({name,source,output:expected})=>{
  expect(reference.serviceCases.find(row=>row.name===name)).toMatchObject({source,status:0,signal:null,stdout:expected,stderr:""});
  let reads=0,output="";
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],
    input:{readLine(){reads++;return "service\n";}},output:{write(text){output+=text;},flush(){}}
  });
  const result=session.exec(source);
  expect(result.status,JSON.stringify(result)).toBe("ok");
  expect(output).toBe(expected);
  expect(reads).toBe(1);
});

it.each(osErrorServiceCases.flatMap(row=>[false,true].map(throws=>({...row,throws}))))("keeps OSError callback cancellation terminal: $name (throws=$throws)",({source,throws})=>{
  const controller=new AbortController();
  let reads=0,output="";
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();if(throws)throw Error("service failure");return "service\n";}},
    output:{write(text){output+=text;},flush(){}}
  });
  const expected={status:"terminated",reason:"cancelled",message:"execution cancelled"};
  expect(session.exec(source)).toEqual(expected);
  expect(session.eval("1")).toEqual(expected);
  expect(reads).toBe(1);
  expect(output).toBe("");
});
