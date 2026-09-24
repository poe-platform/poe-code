import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createTarCommand } from "../../src/commands/archive/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const [label, maxMembers, files, expectedLimits, success] of [
  ["oversized directory", 2, 64, [1], false],
  ["exact allowance", 3, 2, [2], true],
  ["empty directory at exhausted allowance", 1, 0, [0], true],
  ["default members", undefined, 2, [undefined], true],
] as const) {
  test(`tar admits ${label} before directory allocation`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/sub");
    for (let index = 0; index < files; index++) await fs.writeFile(`/sub/file-${index}`, Buffer.from("x"));
    const readdir = context.mock.method(fs, "readdir");
    const shell = new Shell({ fs, commands: new CommandRegistry([createTarCommand(maxMembers === undefined ? {} : { limits: { maxMembers } })]) });
    context.after(() => shell.dispose());
    const result = await shell.exec("tar --format=ustar -cf - sub");
    assert.deepEqual(readdir.mock.calls.map(call => call.arguments[1]?.maxEntries), expectedLimits);
    assert.equal(result.exitCode, success ? 0 : 2, result.stderr);
    if (!success) assert.equal(result.stdout, "");
  });
}

test("tar passes the decreasing member allowance to nested directory walks", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/sub/nested", { recursive: true });
  await fs.writeFile("/sub/nested/file", Buffer.from("x"));
  const readdir = context.mock.method(fs, "readdir");
  const shell = new Shell({ fs, commands: new CommandRegistry([createTarCommand({ limits: { maxMembers: 3 } })]) });
  context.after(() => shell.dispose());
  const result = await shell.exec("tar --format=ustar -cf - sub");
  assert.deepEqual(readdir.mock.calls.map(call => [call.arguments[0], call.arguments[1]?.maxEntries]), [["/sub", 2], ["/sub/nested", 1]]);
  assert.equal(result.exitCode, 0, result.stderr);
});
