import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const name of ["startswith", "endswith"]) {
  for (const [input, argument] of [['123', '"1"'], ['"123"', '3'], ['null', '"a"'], ['"a"', 'null']]) {
    test(`${runtime} jq ${input} | ${name}(${argument})`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
      const {jqCommands} = await import("safe-bash-command-jq");
      const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(jqCommands())
        : new RustWasmBash({cwd: "/", forceNative: true});
      try {
        for (const nullInput of [false, true]) {
          const result = await shell.exec(`jq ${nullInput ? "-nc" : "-c"} '${input} | ${name}(${argument})'`, {stdin: "null"});
          assert.deepEqual([result.exitCode, result.stdout, result.stderr],
            [5, "", `jq: error (at ${nullInput ? "<unknown>" : "<stdin>:0"}): ${name}() requires string inputs\n`]);
        }
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
