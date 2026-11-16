import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const iterations of [1, 2]) {
  test(`${runtime} basename extra operands retain diagnostics and substitution status (${iterations} iterations)`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const command = "x=$(basename foo.txt -s .txt bar.txt)";
      const result = await shell.exec(iterations === 1 ? command : `for i in 1 2; do ${command}; done`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "basename: extra operand '.txt'\nTry 'basename --help' for more information.\n".repeat(iterations));
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
