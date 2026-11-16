import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Expected results checked against GNU awk and mawk.
const cases = [
  ["scalar EOF", 'BEGIN{x="seed";r=getline x;print r,"["x"]",NR,FNR}', "", "0 [seed] 0 0\n"],
  ["scalar after record", 'BEGIN{x="seed";r=getline x;print r,"["x"]",NR,FNR;r=getline x;print r,"["x"]",NR,FNR}', "a\n", "1 [a] 1 1\n0 [a] 1 1\n"],
  ["action EOF", '{x="seed";r=getline x;print r,"["x"]",NR,FNR,$0}', "a\n", "0 [seed] 1 1 a\n"],
  ["array EOF", 'BEGIN{i=0;a[0]="seed";r=getline a[i++];print r,i,length(a),"["a[0]"]"}', "", "0 1 1 [seed]\n"],
  ["new array target EOF", 'BEGIN{i=0;r=getline a[i++];print r,i,(0 in a),length(a)}', "", "0 1 1 1\n"],
  ["array record", 'BEGIN{i=0;a[0]="seed";r=getline a[i++];print r,i,length(a),"["a[0]"]"}', "value\n", "1 1 1 [value]\n"],
  ["target before read", 'BEGIN{r=getline a[NR];print r,(0 in a),(1 in a)}', "value\n", "1 1 0\n"],
  ["field EOF", 'BEGIN{$0="left right";i=1;r=getline $(i++);print r,i,NF,$0}', "", "0 2 2 left right\n"],
  ["field record", 'BEGIN{$0="left right";i=1;r=getline $(i++);print r,i,NF,$0}', "value\n", "1 2 2 value right\n"],
  ["record EOF", 'BEGIN{$0="seed";r=getline;print r,"["$0"]",NF}', "", "0 [seed] 1\n"],
];

for (const runtime of ["TypeScript", "Rust"]) for (const [name, program, stdin, stdout] of cases) {
  for (const redirected of [false, true]) {
    test(`${runtime} awk ${name}, redirected=${redirected}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
      const {awkCommands} = await import("safe-bash-command-awk");
      const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem(), cwd: "/"}).use(awkCommands())
        : new RustWasmBash({cwd: "/", forceNative: true});
      try {
        // Redirected reads do not advance NR/FNR. The action case uses its main record.
        const source = redirected ? program.replaceAll(/getline( a\[i\+\+\]| \$\(i\+\+\)| x)?/g, 'getline$1 < "/dev/stdin"') : program;
        const expected = redirected && name === "scalar after record" ? "1 [a] 0 0\n0 [a] 0 0\n" : stdout;
        const result = await shell.exec(`awk '${source}'`, {stdin});
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, expected, ""]);
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
