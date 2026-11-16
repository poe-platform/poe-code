import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const loops = [
  body => `for ((i=0;i<3;i++)); do ${body}; done`,
  body => `for ((i=0;i<6;i+=2)); do ${body}; done`,
  body => `for i in 1 2 3; do ${body}; done`,
];
for (const runtime of ["TypeScript", "Rust"]) for (const [index, loop] of loops.entries()) {
  for (const command of ['echo "hello world"', 'printf "%s\\n" "hello world"']) for (const redirect of [">", ">>"]) {
    // Limits apply to writes, so use complete-record boundaries when comparing
    // retained content across implementations with different output chunking.
    for (const maxOutputBytes of [12, 20, 36]) {
      test(`${runtime} loop ${index} ${command} ${redirect} preserves redirection effects at ${maxOutputBytes} bytes`, {skip: !WebAssembly.Suspending}, async () => {
        const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
        const fs = createMemoryFileSystem();
        const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
          : new RustWasmBash({fs, cwd: "/", forceNative: true});
        try {
          const result = shell.exec(loop(`${command} ${redirect} /out`), {limits: {maxOutputBytes}});
          if (maxOutputBytes < 36) await assert.rejects(result, {name: "ShellLimitError", limit: "maxOutputBytes"});
          else assert.equal((await result).exitCode, 0);
          const lines = maxOutputBytes < 36 ? (redirect === ">" ? 0 : 1) : (redirect === ">" ? 1 : 3);
          assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "hello world\n".repeat(lines));
          if (runtime === "Rust") assert.equal(shell._companion, null);
        } finally {await shell.dispose();}
      });
    }
  }
}
