import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, MemoryFileSystem, Shell, createTextProgramCommands } from "../../../src/index.js";

for (const option of ["-l ordchr", "-lordchr", "--load ordchr", "--load=ordchr", "-l /usr/lib/x86_64-linux-gnu/gawk/ordchr.so", "--load=/usr/lib/x86_64-linux-gnu/gawk/ordchr.so"]) {
  test(`awk bounded ordchr via ${option}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("Changed\nDelta\n"));
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${option} '{print ord($1), chr(70)}' /input`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "67 F\n68 F\n");
    assert.equal(result.stderr, "");
  });
}

test("ordchr preserves C-locale bytes and wraps truncated integers", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  const result = await shell.exec(`awk -l ordchr 'BEGIN { printf "%s%s%s", chr(255), chr(256), chr(-1.9); print ord(""), ord("AB") }'`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.from([255, 0, 255, ...Buffer.from("0 65\n")]));
});

for (const command of ["awk -l", "awk --load=unknown 'BEGIN {print 1}'", "awk -l ordchr 'BEGIN {print ord()}'", "awk -l ordchr 'BEGIN {print chr(1,2)}'", "awk -l ordchr 'function ord(x) {return x} BEGIN {print 1}'", "awk 'BEGIN {print ord(\"A\")}'"]) {
  test(`awk rejects invalid extension invocation: ${command}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });
}

test("ordchr calls retain the configured execution limit", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands({ maxSteps: 32 })) });
  context.after(() => shell.dispose());
  const result = await shell.exec(`awk -l ordchr 'BEGIN { for (;;) x=ord(chr(65)) }'`);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /execution step limit exceeded/u);
  assert.equal(result.stdout, "");
});

test("user ord functions remain available when the extension is not selected", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  const result = await shell.exec(`awk 'function ord(x) { return x+1 } BEGIN {print ord(2)}'`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "3\n");
});
