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
  test(`find output and pipelines ignore deleted ${deletedType} entries`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/a.txt", Uint8Array.of(65));
    if (deletedType === "file") await fs.writeFile("/dir/b.txt", Uint8Array.of(66));
    else await fs.mkdir("/dir/b.txt");
    await fs.writeFile("/dir/c.txt", Uint8Array.of(67));
    const shell = new Shell({ fs }).use(standardCommands());
    try {
      const removed = await shell.exec("rm -r /dir/b.txt");
      assert.equal(removed.exitCode, 0, removed.stderr);
      for (const expression of ["", " -type f", ' -name "*"', ' -iname "*"']) {
        const expected = `${expression === " -type f" ? "" : "/dir\n"}/dir/a.txt\n/dir/c.txt\n`;
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
