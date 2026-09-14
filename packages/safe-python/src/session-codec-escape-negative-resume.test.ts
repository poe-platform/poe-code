import {expect,it} from "vitest";
import {PythonSession,type PythonWarning} from "./index.js";
import reference from "./runtime/__snapshots__/unicode-escape-negative-resume-fd-audit.json";

it.each(reference.cases)("escape source replacement in __index__: raw=$raw final=$final",row=>{
  expect(row.oracle.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(row.oracle.reference.unicode).toBe("16.0.0");
  expect(row.oracle.reference.platform).toBe("darwin");
  expect(row.oracle.reference.byteorder).toBe("little");
  expect(row.oracleStatus).toBe(0);
  expect(row.oracleStderr).toBe("");
  const warnings:PythonWarning[]=[];
  let output="",reads=0;
  const session=new PythonSession({
    hashSeed:[1n,2n],limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    input:{readLine(){reads++;return "continue\n";}},
    output:{write(text){output+=text;},flush(){}},warning(warning){warnings.push(warning);}
  });
  expect(session.exec(row.source,{filename:"edge-resume.py"})).toEqual({status:"ok"});
  expect(output).toBe(row.oracle.stdout);
  expect(warnings.map(warning=>({category:warning.category,message:warning.message,filename:warning.filename,line:warning.position?.line}))).toEqual(row.oracle.warnings);
  expect(reads).toBe(1);
});

it.each(reference.cases)("escape negative resume cancellation: raw=$raw final=$final",row=>{
  for(const throws of [false,true]){
    const controller=new AbortController();
    let reads=0,output="",warnings=0;
    const session=new PythonSession({
      hashSeed:[1n,2n],limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},signal:controller.signal,
      input:{readLine(){reads++;controller.abort();if(throws)throw Error("cancelled input service");return "continue\n";}},
      output:{write(text){output+=text;},flush(){}},warning(){warnings++;}
    });
    expect(session.exec(row.source,{filename:"edge-resume.py"})).toMatchObject({status:"terminated",reason:"cancelled"});
    expect(session.exec("pass")).toMatchObject({status:"terminated",reason:"cancelled"});
    expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
    expect(reads).toBe(1);
    expect(output).toBe("");
    expect(warnings).toBe(row.oracle.warnings.length);
  }
});
