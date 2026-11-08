import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

test("find ignores deleted memory-directory entries", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/kept", Uint8Array.of(65));
  await fs.writeFile("/deleted", Uint8Array.of(66));
  await fs.unlink("/deleted");
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("find / -type f");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/kept\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const deletedType of ["file", "directory"] as const) {
for (const deletedName of ["a.txt", "b.txt", "c.txt"]) {
  test(`find output and pipelines ignore deleted ${deletedType} ${deletedName}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir");
    const names = ["a.txt", "b.txt", "c.txt"];
    for (const name of names) {
      if (name === deletedName && deletedType === "directory") await fs.mkdir(`/dir/${name}`);
      else await fs.writeFile(`/dir/${name}`, Uint8Array.of(65));
    }
    const shell = new Shell({ fs }).use(standardCommands());
    try {
      const removed = await shell.exec(`rm -r /dir/${deletedName}`);
      assert.equal(removed.exitCode, 0, removed.stderr);
      for (const expression of ["", " -type f", ' -name "*"', ' -iname "*"']) {
        const remaining = names.filter(name => name !== deletedName).map(name => `/dir/${name}\n`).join("");
        const expected = `${expression === " -type f" ? "" : "/dir\n"}${remaining}`;
        const result = await shell.exec(`find /dir${expression}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
        const count = await shell.exec(`find /dir${expression} | wc -l`);
        assert.equal(count.exitCode, 0, count.stderr);
        assert.equal(count.stdout.trim(), expression === " -type f" ? "2" : "3");
        assert.equal(count.stderr, "");
      }
    } finally { await shell.dispose(); }
  });
}
}

for (const operation of ["rm /dir/a.txt /dir/c.txt", "mv /dir/a.txt /dir/c.txt /moved/"]) {
  test(`find ignores multiple vacated entries after ${operation}`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(standardCommands());
    try {
      const setup = await shell.exec(`mkdir /dir /moved && touch /dir/a.txt /dir/b.txt /dir/c.txt && ${operation}`);
      assert.equal(setup.exitCode, 0, setup.stderr);
      for (const expression of ["-type f", "-name '*'", "-iname '*'"]) {
        const expected = expression === "-type f" ? "/dir/b.txt\n" : "/dir\n/dir/b.txt\n";
        const result = await shell.exec(`find /dir ${expression}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
        const count = await shell.exec(`find /dir ${expression} | wc -l`);
        assert.equal(count.exitCode, 0, count.stderr);
        assert.equal(count.stdout.trim(), expression === "-type f" ? "1" : "2");
        assert.equal(count.stderr, "");
      }
    } finally { await shell.dispose(); }
  });
}
