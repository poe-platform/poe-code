import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const bytes=readFileSync(new URL("../tests/fixtures/unzip-selection.zip",import.meta.url));
const reference=JSON.parse(readFileSync(new URL("../tests/fixtures/unzip-selection.json",import.meta.url)));
assert.equal(createHash("sha256").update(bytes).digest("hex"),reference.fixtureSha256);
for(const runtime of ["TypeScript","Rust"]) for(const sample of reference.cases) {
  test(`${runtime} unzip selection ${sample.args.join(" ")}`,{skip:!WebAssembly.Suspending},async()=>{
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const memory=runtime==="TypeScript"?createMemoryFileSystem():undefined;
    const shell=memory?new Shell({fs:memory}).use(agentCommands()):new RustWasmBash({cwd:"/",forceNative:true});
    const fs=memory??shell.fs;
    try {
      await fs.writeFile("/input.zip",bytes);
      const result=await shell.exec(`unzip ${sample.args.map(arg=>`'${arg.replaceAll("'","'\\''")}'`).join(" ")}`);
      assert.equal(result.exitCode,sample.status);
      // Listing date formats vary by native build; selection counts and diagnostics do not.
      if(sample.args[0]==="-l"||sample.args[0]==="-v") {
        assert.equal(result.stdout.split("\n").at(-2),sample.stdout.split("\n").at(-2));
        assert.equal(result.stdout.includes("a.txt"),sample.stdout.includes("a.txt"));
        assert.equal(result.stdout.includes("caution:"),false);
      } else assert.equal(result.stdout,sample.stdout);
      assert.equal(result.stderr,sample.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/input.zip")),bytes);
      if(sample.args[0]==="-oq" && sample.args.includes("a.txt")) assert.equal(Buffer.from(await fs.readFile("/out/a.txt")).toString(),"a");
      if(runtime==="Rust"){assert.equal(shell.forceNative,true);assert.equal(shell._companion,null);}
    } finally {await shell.dispose();}
  });
}
