import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const mode of ["b", "c", "f"]) {
  for (const spec of ["1,2-3-4", "2-3-4", "1,2--3"]) for (const route of ["stdin", "pipeline", "substitution", "loop"]) {
    test(`${runtime} cut -${mode}${spec} rejects malformed range via ${route}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
        : new RustWasmBash({cwd: "/", forceNative: true});
      try {
        const cut = `cut -${mode}${spec}`;
        const pipeline = `printf 'a\\tb\\tc\\n' | ${cut}`;
        const source = route === "stdin" ? cut : route === "pipeline" ? pipeline
          : route === "substitution" ? `out=$(${pipeline})` : `for i in 1 2; do out=$(${pipeline}); done`;
        const result = await shell.exec(source, {stdin: "a\tb\tc\n"});
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, `cut: invalid ${mode === "f" ? "field" : "byte or character"} range\nTry 'cut --help' for more information.\n`.repeat(route === "loop" ? 2 : 1));
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
