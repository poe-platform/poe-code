import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU sed 4.9: buffered file output closes before the final stdout flush.
for (const runtime of ["TypeScript", "Rust"]) for (const flag of ["", "-u"]) {
  test(`${runtime} sed ${flag} in-place and file output share capacity`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/"}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    try {
      await fs.writeFile("/input",new TextEncoder().encode("abc\n"));
      await assert.rejects(shell.exec(`sed ${flag} -i -e 's/a/b/' -e 'w /out' /input`,{limits:{maxOutputBytes:4}}),{name:"ShellLimitError",limit:"maxOutputBytes"});
      assert.equal(new TextDecoder().decode(await fs.readFile("/input")),flag ? "abc\n" : "bbc\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")),flag ? "bbc\n" : "");
      if(runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
  test(`${runtime} sed ${flag} preserves unterminated binary file output`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/"}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    try {
      const result=await shell.exec(`sed ${flag} -n 'w /out'`,{stdin:Uint8Array.of(0,255)});
      assert.deepEqual([result.stdout,result.stderr,result.exitCode],["","",0]);
      assert.deepEqual(await fs.readFile("/out"),Uint8Array.of(0,255));
      if(runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
  for (const extra of ["", " 2>/dev/null"]) test(`${runtime} sed ${flag} shared output${extra}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/"}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    try {
      await fs.writeFile("/input",new TextEncoder().encode("longer-first-line\n"));
      const result=await shell.exec(`sed ${flag} -e 'w /out' -e 's/longer-first-line/short/' /input >/out${extra}`);
      assert.deepEqual([result.stdout,result.stderr,result.exitCode],["","",0]);
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")),"short\n-first-line\n");
      if(runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
  for (const separate of ["", "-s"]) test(`${runtime} sed ${flag} ${separate} file buffering`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/"}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    try {
      await fs.writeFile("/one",new TextEncoder().encode("one\n"));
      await fs.writeFile("/two",new TextEncoder().encode("two\n"));
      const result=await shell.exec(`sed ${flag} ${separate} -n -e 'w /out' -e 'r /out' /one /two`);
      assert.deepEqual([result.stdout,result.stderr,result.exitCode],[flag ? "one\none\ntwo\n" : "","",0]);
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")),"one\ntwo\n");
      if(runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
