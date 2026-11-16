import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  for (const input of ['"a\\"b"\n', '"first\nsecond"', "'first\nsecond'", '"unfinished', "'unfinished"]) {
    test(`${runtime} xargs rejects malformed quoting ${JSON.stringify(input)}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const fs = createMemoryFileSystem();
      const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
        : new RustWasmBash({fs, cwd: "/", forceNative: true});
      let calls = 0;
      shell.use({name: "xargs-observer", setup(host) {
        host.commands.register({name: "observe", execute() {calls++; return {exitCode: 0};}});
      }});
      try {
        for (const options of ["", "-I{}", "-L1"]) {
          const result = await shell.exec(`xargs ${options} observe`, {stdin: input});
          assert.equal(result.exitCode, 1);
          assert.equal(result.stdout, "");
          assert.match(result.stderr, /unmatched.*quote/);
          assert.equal(calls, 0);
        }
        for (const delimiter of ["-0", "-d '|'"]) {
          const result = await shell.exec(`xargs ${delimiter} printf '<%s>'`, {stdin: input});
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, `<${input}>`);
          assert.equal(result.stderr, "");
        }
        const valid = await shell.exec("xargs printf '<%s>\\n'", {stdin: '"a\\b" \'c\\d\' escaped\\ space'});
        assert.deepEqual({exitCode: valid.exitCode, stdout: valid.stdout, stderr: valid.stderr},
          {exitCode: 0, stdout: "<a\\b>\n<c\\d>\n<escaped space>\n", stderr: ""});
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
