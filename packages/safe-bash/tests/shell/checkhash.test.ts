import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";

test("checkhash defaults off and survives snapshots with isolated subshell changes", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  t.after(() => shell.dispose());
  const initial = await shell.exec("shopt -p checkhash", { onState() {} });
  assert.equal(initial.stdout, "shopt -u checkhash\n");
  assert.equal(initial.stderr, "");
  assert.equal(initial.exitCode, 1);
  assert.equal(initial.state?.options?.checkhash, false);
  const enabled = await shell.exec("shopt -s checkhash", { state: initial.state });
  assert.equal(enabled.exitCode, 0);
  assert.equal(enabled.state?.options?.checkhash, true);
  const restored = await shell.exec("(shopt -u checkhash; shopt -p checkhash); shopt -p checkhash", { state: enabled.state });
  assert.equal(restored.stdout, "shopt -u checkhash\nshopt -s checkhash\n");
  assert.equal(restored.stderr, "");
  assert.equal(restored.exitCode, 0);
});

for (const option of ["", "shopt -u checkhash;", "shopt -s checkhash;"]) {
  for (const invocation of ["tool", "command tool"]) {
    test(`removed cached executable: ${option || "default"} ${invocation}`, async t => {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/a");
      await fs.mkdir("/b");
      for (const directory of ["a", "b"]) {
        await fs.writeFile(`/${directory}/tool`, new TextEncoder().encode(`#!/bin/sh\necho ${directory.toUpperCase()}\n`), { mode: 0o755 });
      }
      const shell = new Shell({ fs, env: { PATH: "/a" } }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`hash -p /b/tool tool; rm /b/tool; ${option} ${invocation}; echo "tool=$?"; hash -t tool`);
      const enabled = option === "shopt -s checkhash;";
      assert.equal(result.stdout, enabled ? "A\ntool=0\n/a/tool\n" : "tool=127\n/b/tool\n");
      if (enabled) assert.equal(result.stderr, "");
      else assert.match(result.stderr, /\/b\/tool: No such file or directory/);
      assert.equal(result.exitCode, 0);
    });
  }
}

for (const enabled of [false, true]) {
  for (const mode of [0o755, 0o644]) {
    test(`cached executable mode ${mode.toString(8)} with checkhash ${enabled}`, async t => {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/a");
      await fs.mkdir("/b");
      await fs.writeFile("/a/tool", new TextEncoder().encode("#!/bin/sh\necho A\n"), { mode: 0o755 });
      await fs.writeFile("/b/tool", new TextEncoder().encode("#!/bin/sh\necho B\n"), { mode });
      const shell = new Shell({ fs, env: { PATH: "/a" } }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`hash -p /b/tool tool; shopt -${enabled ? "s" : "u"} checkhash; tool; echo "tool=$?"; hash -t tool`);
      const fallback = enabled && mode === 0o644;
      assert.equal(result.stdout, fallback ? "A\ntool=0\n/a/tool\n" : mode === 0o755 ? "B\ntool=0\n/b/tool\n" : "tool=126\n/b/tool\n");
      if (!enabled && mode === 0o644) assert.match(result.stderr, /Permission denied/);
      else assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("checkhash removes a stale entry even when PATH has no replacement", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/missing" } }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec('hash -p /missing/tool tool; shopt -s checkhash; tool; echo "tool=$?"; hash -l');
  assert.equal(result.stdout, "tool=127\n");
  assert.match(result.stderr, /tool: command not found/);
  assert.equal(result.exitCode, 0);
});

for (const enabled of [false, true]) {
  test(`automatically cached executable with checkhash ${enabled}`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/a");
    await fs.mkdir("/b");
    await fs.writeFile("/a/tool", new TextEncoder().encode("#!/bin/sh\necho A\n"), { mode: 0o755 });
    await fs.writeFile("/b/tool", new TextEncoder().encode("#!/bin/sh\necho B\n"), { mode: 0o755 });
    const shell = new Shell({ fs, env: { PATH: "/a:/b" } }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`tool; rm /a/tool; shopt -${enabled ? "s" : "u"} checkhash; tool; echo "tool=$?"; hash -t tool`);
    assert.equal(result.stdout, enabled ? "A\nB\ntool=0\n/b/tool\n" : "A\ntool=127\n/a/tool\n");
    if (enabled) assert.equal(result.stderr, "");
    else assert.match(result.stderr, /\/a\/tool: No such file or directory/);
    assert.equal(result.exitCode, 0);
  });
}
