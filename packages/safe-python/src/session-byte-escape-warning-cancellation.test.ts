import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/byte-escape-warning-services.json";

it.each(reference.cases)("preserves pinned escape warnings and output: $name",({source,oracle})=>{
  expect(oracle.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(oracle.reference.unicode).toBe("16.0.0");
  expect(oracle.reference.byteorder).toBe("little");
  let output="";
  const warnings:unknown[]=[];
  const session=new PythonSession({hashSeed:[1n,2n],
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    warning(value){warnings.push({category:value.category,message:value.message,filename:value.filename,line:value.position?.line});},
    output:{write(text){output+=text;},flush(){}}});
  expect(session.exec(source,{filename:"escape-warning.py"})).toEqual({status:"ok"});
  expect(output).toBe(oracle.stdout);
  expect(warnings).toEqual(oracle.warnings);
});

it.each(reference.cases.flatMap(row=>["warning","output"].flatMap(stage=>[false,true].map(throws=>({...row,stage,throws})))))("keeps $name $stage cancellation terminal when throws=$throws",({source,stage,throws})=>{
  const controller=new AbortController();
  let warnings=0,writes=0;
  const cancel=()=>{controller.abort();if(throws)throw Error("service failed after cancellation");};
  const session=new PythonSession({hashSeed:[1n,2n],signal:controller.signal,
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    warning(){warnings++;if(stage==="warning")cancel();},
    output:{write(){writes++;if(stage==="output")cancel();},flush(){}}});
  expect(session.exec(source,{filename:"escape-warning.py"})).toMatchObject({status:"terminated",reason:"cancelled"});
  const counts=[warnings,writes];
  expect(stage==="warning"?warnings:writes).toBe(1);
  expect(session.exec("print('resumed')")).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
  expect([warnings,writes]).toEqual(counts);
});
