import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/interpolated-literal-codec-3.14.7.json" with {type:"json"};

it.each(reference.cases)("interpolated literal codec: $name", ({source,stdout,warnings})=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  let output="";
  const observed:unknown[]=[];
  const session=new PythonSession({hashSeed:[1n,2n],
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    warning(warning){observed.push({category:warning.category,message:warning.message,filename:warning.filename,line:warning.position?.line});},
    output:{write(text){output+=text;},flush(){}}});
  const result=session.exec(source);
  expect(result.status,result.status==="terminated"?result.message:undefined).toBe("ok");
  expect(output).toBe(stdout);
  expect(observed).toEqual(warnings);
});

it.each([false,true])("keeps deferred codec warning cancellation terminal (throws=%s)",throws=>{
  const controller=new AbortController();
  let warnings=0,writes=0;
  const session=new PythonSession({hashSeed:[1n,2n],signal:controller.signal,
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    warning(){warnings++;controller.abort();if(throws)throw Error("warning service failed");},
    output:{write(){writes++;},flush(){}}});
  const source=reference.cases.find(row=>row.name===String.raw`f"\q{1}"`)!.source;
  const result=session.exec(source);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(warnings).toBe(1);
  expect(writes).toBe(0);
  expect(session.exec("pass")).toEqual(result);
  expect(session.eval("1")).toEqual(result);
  expect(warnings).toBe(1);
});

it.each([false,true])("keeps deferred codec error output cancellation terminal (throws=%s)",throws=>{
  const controller=new AbortController();
  let writes=0;
  const session=new PythonSession({hashSeed:[1n,2n],signal:controller.signal,
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    output:{write(){writes++;controller.abort();if(throws)throw Error("output service failed");},flush(){}}});
  const result=session.exec(reference.cases[0].source);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(writes).toBe(1);
  expect(session.exec("pass")).toEqual(result);
  expect(session.eval("1")).toEqual(result);
  expect(writes).toBe(1);
});
