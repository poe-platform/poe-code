import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/core-codec-aliases-3.14.7.json";

/** Public consumer evidence. No injected registry, module substitutes or host
 * codec calls: the snapshot contains unchanged guest assertions and byte input
 * evaluated by the external pinned CPython oracle. */
it.each(reference.cases)("matches core codec spelling $encoding ($canonical)",row=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(row.guest)).toEqual({status:"ok"});
  const result=session.exec(Uint8Array.from(row.source),{filename:"codec_source.py"});
  if(row.expected.status==="ok"){
    expect(result).toEqual({status:"ok"});
    expect(session.globals.get("value")?.primitive).toBe(row.expected.value);
  }else{
    expect(result).toMatchObject({status:"diagnostic",diagnostic:{name:"SyntaxError",message:row.expected.message,filename:"codec_source.py",position:{line:row.expected.line,column:row.expected.offset!-1}}});
  }
});
