import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";
const cases = [
  ["skip byte inside UTF-8", "-s 1 -w 1", Buffer.from("😀a\n😀b\n"), Buffer.from("😀a\n")],
  ["limit inside UTF-8", "-w 1", Buffer.from("😀a\n😁a\n"), Buffer.from("😀a\n")],
  ["skip field then bytes", "-f 1 -s 2 -w 1", Buffer.from("x 😀a\nx 😀b\n"), Buffer.from("x 😀a\n")],
  ["case folding after skip", "-i -s 1 -w 1", Buffer.from("xA\nxa\nxB\n"), Buffer.from("xA\nxB\n")],
  ["invalid bytes", "-s 1 -w 1", Buffer.from([97,255,10,98,254,10]), Buffer.from([97,255,10,98,254,10])],
  ["NUL records", "-z -w 1", Buffer.from("😀a\0😁a\0"), Buffer.from("😀a\0")],
  ["zero width", "-w 0", Buffer.from("a\nb\n"), Buffer.from("a\n")],
];
const locales = [
  ["C", "LC_ALL=C", false],
  ["UTF-8", "LC_ALL=C.UTF-8", true],
  ["default", "", false],
  ["empty LC_ALL", "LC_ALL='' LC_CTYPE=C LANG=C.UTF-8", false],
  ["empty categories", "LC_ALL='' LC_CTYPE='' LANG=C.UTF-8", true],
];
for (const runtime of ["TypeScript", "Rust"]) for (const [locale,env,unicode] of locales) {
  test(`${runtime} uniq locale windows in ${locale}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const memory=runtime==="TypeScript"?createMemoryFileSystem():undefined;
    const shell=memory?new Shell({fs:memory}).use(agentCommands()):new RustWasmBash({cwd:"/",forceNative:true});
    const fs=memory??shell.fs;
    try {
      for(const [name,args,input,byteExpected] of cases) {
        const expected=unicode && ["skip byte inside UTF-8","limit inside UTF-8","skip field then bytes","NUL records"].includes(name)?input:byteExpected;
        await fs.writeFile("/input",input);
        const command=`${env} uniq ${args}`;
        for (const source of [`${command} input`, `cat input | ${command}`]) {
          const result=await shell.exec(source);
          assert.equal(result.exitCode,0,`${name}: ${result.stderr}`);
          assert.equal(result.stderr,"");
          assert.deepEqual(Buffer.from(result.stdoutBytes),expected,`${name}: ${source}`);
        }
        if(name==="limit inside UTF-8") for(const source of [`out=$(${command} input); printf '%s\\n' "$out"`, `for i in 1 2; do out=$(${command} input); done; printf '%s\\n' "$out"`]) {
          const result=await shell.exec(source);
          assert.equal(result.exitCode,0,result.stderr);
          assert.deepEqual(Buffer.from(result.stdoutBytes),expected,source);
        }
      }
      if(runtime==="Rust") {assert.equal(shell.forceNative,true);assert.equal(shell._companion,null);}
    } finally {await shell.dispose();}
  });
}
