import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";
for(const runtime of ["TypeScript","Rust"]) test(`${runtime} fold preserves argument diagnostics and implementation identity`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const memory=runtime==="TypeScript"?createMemoryFileSystem():undefined;
  const shell=memory?new Shell({fs:memory}).use(agentCommands()):new RustWasmBash({cwd:"/",forceNative:true});
  const fs=memory??shell.fs;
  try {
    await fs.writeFile("/input",new TextEncoder().encode("preserve input"));
    for(const value of ["0","-3","3b","18446744073709551616"]) {
      const r=await shell.exec(`fold -w '${value}' /input`);
      assert.equal(r.exitCode,1);assert.equal(r.stdout,"");
      assert.equal(r.stderr,`fold: invalid number '${value}'\n`);
    }
    const r=await shell.exec("fold --version -- /missing");
    assert.equal(r.exitCode,0);assert.equal(r.stderr,"");
    assert.equal(r.stdout,"fold (safe-bash virtual implementation)\n");
    assert.equal(Buffer.from(await fs.readFile("/input")).toString(),"preserve input");
    if(runtime==="Rust"){assert.equal(shell.forceNative,true);assert.equal(shell._companion,null);}
  } finally {await shell.dispose();}
});
