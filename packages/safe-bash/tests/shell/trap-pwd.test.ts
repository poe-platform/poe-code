import assert from "node:assert/strict";
import test from "node:test";
import { Shell, MemoryFileSystem } from "../../src/core.js";
import { basicCommands } from "../../src/commands/basic.js";
import { trapExtension } from "../../src/shell/extensions/trap/index.js";

for (const extensions of [undefined, [trapExtension()]]) {
  test(`automatic command spelling preserves expansion budgets ${extensions ? "configured" : "default"}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), ...(extensions ? { extensions } : {}) });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const empty = await shell.exec("scalar=", { limits: { maxExpansionBytes: 0, maxExpansionFields: 1 } });
    assert.equal(empty.exitCode, 0);
    assert.equal(empty.stderr, "");
    const result = await shell.exec('BASH_COMMAND=stale; printf "%s" "$BASH_COMMAND"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, 'printf "%s" "$BASH_COMMAND"');
  });
  for (const [source, status] of [
    ["trap 'true; exit' EXIT; exit 7", 7],
    ["trap 'false; exit' EXIT; exit 0", 0],
    ["trap 'exit 9' EXIT; exit 7", 9],
    ["trap 'true; eval exit' EXIT; exit 7", 7],
  ] as const) test(`EXIT status ${extensions ? "configured" : "default"}: ${source}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), ...(extensions ? { extensions } : {}) });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, status);
  });
  test(`inherited trap inspection ${extensions ? "configured" : "default"}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), ...(extensions ? { extensions } : {}) });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec("trap 'printf bad' EXIT; saved=$(trap -p EXIT); printf '%s\\n' \"$saved\"; (trap -p EXIT); trap - EXIT");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "trap -- 'printf bad' EXIT\ntrap -- 'printf bad' EXIT\n");
  });
}

test("pwd uses the last logical/physical flag and rejects invalid options", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/target");
  await fs.symlink("/target", "/link");
  const shell = new Shell({ fs, cwd: "/link" });
  context.after(() => shell.dispose());
  for (const [args, path] of [["-LP", "/target"], ["-PL", "/link"], ["-P -L --", "/link"]]) {
    const result = await shell.exec(`pwd ${args}`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `${path}\n`);
  }
  assert.equal((await shell.exec("pwd -Q")).exitCode, 2);
});

for (const args of ["--", "-P --", "-LP", "-PL", "/extra", "-- -Q", "/extra -Q"]) {
  test(`pwd accepts ${args}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(`pwd ${args}`);
    assert.equal(result.stdout, "/\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
