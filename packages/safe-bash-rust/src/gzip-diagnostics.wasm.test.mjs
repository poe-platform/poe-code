import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) test(`${runtime} gzip escapes filename controls and preserves Unicode`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const fs = createMemoryFileSystem();
  const name = "/é\\bad\u001b[31m\u007f\u009b\b\v\f\r\t\n.gz";
  await fs.writeFile(name, Buffer.from("plain"));
  const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
    : new RustWasmBash({fs, cwd: "/", forceNative: true});
  try {
    const result = await shell.exec(`gzip -d '${name}'`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "gzip: /é\\bad\\033[31m\\177\\302\\233\\b\\v\\f\\r\t\n.gz: not in gzip format\n");
    assert.equal(Buffer.from(await fs.readFile(name)).toString(), "plain");
    assert.equal((await shell.exec(`test ! -e '${name.slice(0, -3)}'`)).exitCode, 0);
    if (runtime === "Rust") assert.equal(shell._companion, null);
  } finally {await shell.dispose();}
});

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
