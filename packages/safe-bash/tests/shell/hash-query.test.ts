import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

test("hash -t queries only cached commands, including after deletion and reset", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", new TextEncoder().encode("#!/bin/sh\n:"), { mode: 0o755 });
  const shell = new Shell({ fs, env: { PATH: "/bin" } });
  context.after(() => shell.dispose());

  for (const setup of ["", "hash tool; hash -d tool;", "hash tool; hash -r;"]) {
    const result = await shell.exec(`${setup} hash -t tool`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("hash: tool: not found"));
  }

  const result = await shell.exec("hash tool; hash -t tool");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "/bin/tool\n");
  assert.equal(result.stderr, "");
});
