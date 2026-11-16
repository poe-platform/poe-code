import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const [bytes, message] of [
  [Buffer.from("plain"), "not in gzip format"],
  [Buffer.from([0x1f, 0x8b]), "unexpected end of file"],
]) for (const command of ["gzip -d", "gzip -dc", "gzip -t", "gunzip", "zcat"]) {
  test(`${runtime} ${command} identifies invalid input: ${message}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.gz", bytes);
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
      : new RustWasmBash({fs, cwd: "/", forceNative: true});
    try {
      for (const [operand, source] of [["input.gz", "/input.gz"], ["- < input.gz", "stdin"]]) {
        const result = await shell.exec(`${command} ${operand}`);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, `${command.split(" ")[0]}: ${source}: ${message}\n`);
        assert.deepEqual(Buffer.from(await fs.readFile("/input.gz")), bytes);
        assert.equal((await shell.exec("test ! -e /input")).exitCode, 0);
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
