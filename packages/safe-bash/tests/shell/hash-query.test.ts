import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";

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

test("hash -t pins a local executable without a second PATH lookup", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/one", { recursive: true });
  await fs.writeFile("/work/zz", new TextEncoder().encode("#!/bin/sh\necho cwd\n"), { mode: 0o755 });
  await fs.writeFile("/work/one/zz", new TextEncoder().encode("#!/bin/sh\necho one\n"), { mode: 0o755 });
  const shell = new Shell({ fs, cwd: "/work", env: { PATH: "one" } }).use(standardCommands());
  context.after(() => shell.dispose());

  const result = await shell.exec('hash -p zz sentinel; resolved=$(hash -t sentinel); echo "resolved=$resolved"; "$resolved"');
  assert.equal(result.stdout, "resolved=./zz\ncwd\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const [target, expected] of [
  ["zz", "./zz"],
  ["one/zz", "./one/zz"],
  ["../work/zz", "./../work/zz"],
  ["./zz", "./zz"],
  ["/work/zz", "/work/zz"],
  ["missing", "missing"],
  ["plain", "plain"],
]) {
  test(`hash -t resolves ${target} without changing hash -l`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/one", { recursive: true });
    for (const path of ["/work/zz", "/work/one/zz", "/work/one/missing"]) {
      await fs.writeFile(path, new TextEncoder().encode("#!/bin/sh\n:"), { mode: 0o755 });
    }
    await fs.writeFile("/work/plain", new TextEncoder().encode("#!/bin/sh\n:"), { mode: 0o644 });
    const shell = new Shell({ fs, cwd: "/work", env: { PATH: "one", TARGET: target! } });
    context.after(() => shell.dispose());

    const result = await shell.exec('hash -p "$TARGET" sentinel; hash -t sentinel; hash -l; hash -p /work/zz other; hash -t sentinel other');
    assert.equal(result.stdout, `${expected}\nbuiltin hash -p '${target}' 'sentinel'\nsentinel\t${expected}\nother\t/work/zz\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
