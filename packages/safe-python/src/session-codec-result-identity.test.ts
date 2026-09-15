import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

// Public consumer evidence only: no injected import, registry or codec callback.
// Literal references expose the pinned platform's empty/Latin-1 singletons.
it.each(["ascii","latin-1","utf-8"])("canonicalizes all single-character %s decode results through public consumers",encoding=>{
  const count=encoding==="ascii"?128:256;
  const entries=["(b'', '')"];
  for(let point=0;point<count;point++){
    const text=String.fromCodePoint(point);
    const bytes=encoding==="utf-8"?new TextEncoder().encode(text):[point];
    const literal=[...bytes].map(byte=>`\\x${byte.toString(16).padStart(2,"0")}`).join("");
    entries.push(`(b'${literal}', '\\u${point.toString(16).padStart(4,"0")}')`);
  }
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`
for data, reference in [${entries.join(",")}]:
    decoded = data.decode('${encoding}')
    constructed = str(data, '${encoding}')
    allocated = str.__new__(str, data, '${encoding}')
    assert type(decoded) is str
    assert decoded is reference, ('decode', ord(reference) if reference else -1)
    assert constructed is reference, ('str', ord(reference) if reference else -1)
    assert allocated is reference, ('new', ord(reference) if reference else -1)
`);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const diagnostic=session.eval("str(failure)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});
