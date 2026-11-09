import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";

for (const assignment of [
  "PATH=$PATH",
  "PATH=/other",
  "PATH+=:",
  "export PATH=$PATH",
  "declare PATH=$PATH",
  'read -r PATH <<< "$PATH"',
  'printf -v PATH %s "$PATH"',
  'for PATH in "$PATH"; do :; done',
  "declare -n pathref=PATH; pathref=$PATH",
  "PATH=$PATH :",
  "f() { local PATH=$PATH; }; f",
]) {
  test(`PATH assignment clears the command hash table: ${assignment}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/a");
    await fs.mkdir("/b");
    for (const directory of ["a", "b"]) {
      await fs.writeFile(`/${directory}/tool`, new TextEncoder().encode("#!/bin/sh\n"), { mode: 0o755 });
    }
    const shell = new Shell({ fs, env: { PATH: "/a" } }).use(standardCommands());
    const result = await shell.exec(`hash -p /b/tool tool; ${assignment}; hash -l; hash -t tool; echo "after=$?"`);
    assert.equal(result.stdout, "after=1\n");
    assert.match(result.stderr, /hash: tool: not found\n$/);
    assert.equal(result.exitCode, 0);
  });
}

test("PATH assignment in a subshell clears only the child hash table", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/a" } });
  const result = await shell.exec("hash -p /b/tool tool; (PATH=$PATH; hash -l); hash -t tool");
  assert.equal(result.stdout, "/b/tool\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("unrelated assignments and export without assignment preserve pinned commands", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/a" } });
  const result = await shell.exec("hash -p /b/tool tool; other=value; export PATH; hash -t tool");
  assert.equal(result.stdout, "/b/tool\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("rejected readonly PATH assignments preserve pinned commands", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/a" } });
  const result = await shell.exec("hash -p /b/tool tool; readonly PATH; export PATH=/other; hash -t tool");
  assert.equal(result.stdout, "/b/tool\n");
  assert.match(result.stderr, /PATH: readonly variable\n$/);
  assert.equal(result.exitCode, 0);
});
