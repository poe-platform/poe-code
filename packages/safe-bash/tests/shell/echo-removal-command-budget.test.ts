import assert from "node:assert/strict";
import test from "node:test";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

test("repeated writes into a removed directory charge each command once", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/", limits: { maxCommands: 4 } }).use(standardCommands());
  context.after(() => shell.dispose());
  const source = "mkdir -p /work/b\necho item_0 > /work/b/f_0.txt\necho item_1 > /work/b/f_1.txt\nrm -rf /work/b";
  for (let run = 0; run < 6; run++) {
    await shell.exec("");
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    await assert.rejects(fs.stat("/work/b"), { code: "ENOENT" });
  }
});

test("command exhaustion before removal preserves preceding mkdir and writes", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/" }).use(standardCommands());
  context.after(() => shell.dispose());
  const source = "mkdir -p /work/a /work/b\necho first > /work/a/one\necho secret > /work/b/f1.txt\necho last > /work/a/two\nrm -rf /work/b";
  for (let run = 0; run < 4; run++) {
    await shell.exec("");
    assert.equal((await shell.exec(source)).exitCode, 0);
  }
  await shell.exec("");
  await assert.rejects(shell.exec(source, { limits: { maxCommands: 4 } }),
    error => error instanceof ShellLimitError && error.limit === "maxCommands");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/b/f1.txt")), "secret\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/a/two")), "last\n");
});
