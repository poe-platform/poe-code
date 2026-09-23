import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

async function run(command: string, args: string[], options: { env?: Record<string, string> } = {}) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()), env: options.env ?? {} });
  try {
    return await shell.exec([command, ...args].map(value => "'" + value.split("'").join("'\\''") + "'").join(" "));
  } finally { await shell.dispose(); }
}

test("printf warns on missing hexadecimal digits while preserving Bash output and status", async () => {
  for (const locale of ["C", "C.UTF-8"]) for (const operand of ["Owned\\x", "Owned\\xGtail", "Owned\\xZ3tail"]) {
    const result = await run("printf", ["%b:END\n", operand], { env: { LC_ALL: locale } });
    assert.equal(result.stdout, `${operand}:END\n`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "printf: missing hex digit for \\x\n");
  }
  const valid = await run("printf", ["%b|%b", "\\x4", "\\x42"]);
  assert.deepEqual(Array.from(valid.stdoutBytes), [4, 124, 66]);
  assert.equal(valid.stderr, "");
  const stopped = await run("printf", ["%b:END", "Owned\\c\\x"]);
  assert.equal(stopped.stdout, "Owned");
  assert.equal(stopped.stderr, "");
});

test("printf hexadecimal warnings preserve redirected bytes and immediate status", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec("printf '%b:END\\n' 'Owned\\xGtail' > /selected.bin; result=$?; printf 'STATUS:%s\\n' \"$result\"; exit \"$result\"");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "STATUS:0\n");
    assert.equal(result.stderr, "printf: missing hex digit for \\x\n");
    assert.equal(Buffer.from(await fs.readFile("/selected.bin")).toString(), "Owned\\xGtail:END\n");
    const raw = await shell.exec("printf '%b' $'\\xff\\\\x'");
    assert.deepEqual(Array.from(raw.stdoutBytes), [255, 92, 120]);
    assert.equal(raw.stderr, "printf: missing hex digit for \\x\n");
  } finally { await shell.dispose(); }
});
