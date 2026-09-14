import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

// Required public integration gates. These use the default interpreter import
// path, not injected modules, builtins, codec callbacks or host Python.
it.each(["codecs","_codecs","encodings","encodings.aliases","encodings.ascii","encodings.latin_1","encodings.utf_8","encodings.charmap"])("imports the real %s module through the public session",name=>{
  const session=new PythonSession({limits:{maxSteps:500000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`import ${name} as module\nassert module.__name__ == ${JSON.stringify(name)}`);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("import_error",result.exception);
    const diagnostic=session.eval("str(import_error)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});
