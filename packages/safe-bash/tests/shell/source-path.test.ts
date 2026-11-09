import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";

test("sourcepath survives snapshots and remains isolated across subshells", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("shopt -u sourcepath", { onState() {} });
  assert.equal(result.state?.options?.sourcepath, false);
  const restored = await shell.exec("(shopt -s sourcepath); shopt -p sourcepath; bash -c 'shopt -p sourcepath'", { state: result.state });
  assert.equal(restored.stderr, "");
  assert.equal(restored.stdout, "shopt -u sourcepath\nshopt -s sourcepath\n");
});

// Expected results verified with GNU Bash 5.3.20.
for (const command of [".", "source"]) {
  for (const [options, filename, before, expected] of [
    ["-p two", "helper", "", "two"],
    ["-p two:one", "helper", "", "two"],
    ["-p missing:one", "helper", "", "one"],
    ["-ptwo", "helper", "", "two"],
    ["-p one -p two --", "helper", "", "two"],
    ["-p ''", "helper", "", "cwd"],
    ["-p missing", "./helper", "", "cwd"],
    ["-p two", "helper", "shopt -u sourcepath;", "two"],
    ["", "helper", "shopt -u sourcepath;", "cwd"],
  ]) {
    test(`${command} ${options} ${filename} after ${before}`, async t => {
      const fs = new MemoryFileSystem();
      for (const directory of ["one", "two"]) await fs.mkdir(`/${directory}`);
      for (const [path, value] of [["/helper", "cwd"], ["/one/helper", "one"], ["/two/helper", "two"]]) {
        await fs.writeFile(path!, new TextEncoder().encode(`value=${value}:$1; return 7`));
      }
      const shell = new Shell({ fs }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`PATH=one:two; set -- original; ${before}
        ${command} ${options} ${filename} 'two words'; echo "$?:$value:$1:$PATH"
        shopt -s sourcepath; ${command} helper again; echo "$?:$value:$1:$PATH"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `7:${expected}:two words:original:one:two\n7:one:again:original:one:two\n`);
    });
  }

  test(`${command} explicit missing path never falls back to PATH or cwd`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/one");
    for (const path of ["/helper", "/one/helper"]) await fs.writeFile(path, new TextEncoder().encode("value=loaded"));
    const shell = new Shell({ fs }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`PATH=one; value=original; ${command} -p missing helper; echo "$?:$value"; ${command} helper; echo "$?:$value"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1:original\n0:loaded\n");
    assert.ok(result.stderr.includes(`${command}: helper: file not found`));
  });

  for (const args of ["-p", "-p two", "-ptwo", "-x"]) {
    test(`${command} rejects incomplete or invalid options: ${args}`, async t => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`${command} ${args}`);
      assert.equal(result.exitCode, 2);
      assert.notEqual(result.stderr, "");
    });
  }
}
