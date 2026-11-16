import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const action of ["remove", "revoke", "revoke; command tool; remove", "cd /other"]) {
  test(`${runtime} empty PATH observes ${action} after execution`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.mkdir("/other");
    await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\nprintf 'ran\\n'\n"), {mode: 0o755});
    const shell = runtime === "TypeScript" ? new Shell({fs, cwd: "/work"}).use(agentCommands())
      : new RustWasmBash({fs, cwd: "/work", forceNative: true});
    shell.use({name: "host-mutations", setup(host) {
      host.commands.register({name: "revoke", async execute() {await fs.chmod("/work/tool", 0o644); return {exitCode: 0};}});
      host.commands.register({name: "remove", async execute() {await fs.rm("/work/tool"); return {exitCode: 0};}});
    }});
    try {
      const result = await shell.exec(`PATH=''; command tool; hash -l; ${action}; command -v tool; printf 'found:%s\\n' "$?"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "ran\nfound:1\n");
      if (action.includes("command tool")) assert.match(result.stderr, /Permission denied/);
      else assert.equal(result.stderr, "");
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
