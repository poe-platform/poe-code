import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { Shell } from "../../safe-bash/src/shell/index.js";
import { archiveCommands } from "../../safe-bash/src/commands/archive/index.js";
import { gzipCommands } from "../../safe-bash/src/commands/gzip/index.js";
import { bzip2Commands } from "../../safe-bash/src/commands/bzip2/index.js";
import { xzCommands } from "../../safe-bash/src/commands/xz/index.js";
import { sedCommands } from "../../safe-bash/src/commands/sed/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);

for (const directory of ["/", "/nested/work"]) {
  test(`zip publishes a readable archive under ${directory} without explicit ancestry`, async () => {
    const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
    await lower.mkdir(directory, { recursive: true });
    await lower.writeFile("/file.txt", bytes("hello world\n"));
    const fs = new OverlayFileSystem({ lower, upper });
    const output = `${directory === "/" ? "" : directory}/out.zip`;
    const shell = new Shell({ fs }).use(archiveCommands());
    try {
      const zipped = await shell.exec(`zip ${output} /file.txt`);
      assert.equal(zipped.exitCode, 0, zipped.stderr);
      const unzipped = await shell.exec(`unzip -p ${output} file.txt`);
      assert.equal(unzipped.exitCode, 0, unzipped.stderr);
      assert.equal(unzipped.stdout, "hello world\n");
      assert.deepEqual(await lower.readFile("/file.txt"), bytes("hello world\n"));
      await assert.rejects(lower.lstat(output), { code: "ENOENT" });
      assert.deepEqual((await upper.readdir(directory)).map(entry => entry.name), ["out.zip"]);
    } finally { await shell.dispose(); }
  });
}

for (const compression of ["", "z", "j", "J"]) {
  test(`tar -x${compression}f extracts files, directories and symlinks into a lower overlay directory`, async () => {
    const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
    await lower.mkdir("/source/tree", { recursive: true, mode: 0o750 });
    await lower.writeFile("/source/tree/file", bytes("hello world\n"), { mode: 0o640 });
    await lower.symlink("file", "/source/tree/link");
    await lower.utimes("/source/tree/file", 123000, 456000);
    await lower.mkdir("/out/tree", { recursive: true });
    await lower.writeFile("/out/tree/file", bytes("previous\n"));
    const fs = new OverlayFileSystem({ lower, upper });
    const shell = new Shell({ fs }).use(archiveCommands());
    try {
      for (const command of [
        `tar -c${compression}f /archive.tar -C /source tree`,
        `tar -x${compression}f /archive.tar -C /out`,
      ]) {
        const result = await shell.exec(command);
        assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
      }
      assert.deepEqual(await fs.readFile("/out/tree/file"), bytes("hello world\n"));
      assert.equal((await fs.lstat("/out/tree/file")).mode & 0o777, 0o640);
      assert.equal((await fs.lstat("/out/tree/file")).mtimeMs, 456000);
      assert.equal((await fs.lstat("/out/tree")).mode & 0o777, 0o750);
      assert.equal(await fs.readlink("/out/tree/link"), "file");
      assert.deepEqual(await lower.readFile("/out/tree/file"), bytes("previous\n"));
      assert.deepEqual(await lower.readFile("/source/tree/file"), bytes("hello world\n"));
      assert.deepEqual((await upper.readdir("/out/tree")).map(entry => entry.name).sort(), ["file", "link"]);
    } finally { await shell.dispose(); }
  });
}

for (const [compress, decompress, suffix] of [
  ["gzip", "gunzip", ".gz"], ["bzip2", "bunzip2", ".bz2"], ["xz", "unxz", ".xz"],
] as const) {
  for (const keep of [false, true]) {
    test(`${compress} round-trips a nested lower file with keep=${keep}`, async () => {
      const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
      await lower.mkdir("/nested/work", { recursive: true });
      await lower.writeFile("/nested/work/file", bytes("hello world\n"));
      const fs = new OverlayFileSystem({ lower, upper });
      const shell = new Shell({ fs }).use(gzipCommands()).use(bzip2Commands()).use(xzCommands());
      try {
        const compressed = await shell.exec(`${compress} ${keep ? "-k " : ""}/nested/work/file`);
        assert.equal(compressed.exitCode, 0, compressed.stderr);
        assert.ok((await fs.readFile(`/nested/work/file${suffix}`)).length > 0);
        if (keep) assert.deepEqual(await fs.readFile("/nested/work/file"), bytes("hello world\n"));
        else await assert.rejects(fs.lstat("/nested/work/file"), { code: "ENOENT" });
        const decoded = await shell.exec(`${decompress} ${keep ? "-f " : ""}/nested/work/file${suffix}`);
        assert.equal(decoded.exitCode, 0, decoded.stderr);
        assert.deepEqual(await fs.readFile("/nested/work/file"), bytes("hello world\n"));
        assert.deepEqual(await lower.readFile("/nested/work/file"), bytes("hello world\n"));
        assert.deepEqual((await upper.readdir("/nested/work")).map(entry => entry.name), ["file"]);
      } finally { await shell.dispose(); }
    });
  }
}

test("sed -i preserves lower files and replaces nested lower backups", async () => {
  const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
  await lower.mkdir("/nested/work", { recursive: true });
  await lower.writeFile("/nested/work/file", bytes("hello world\n"), { mode: 0o640 });
  await lower.writeFile("/nested/work/file.bak", bytes("old backup\n"));
  const fs = new OverlayFileSystem({ lower, upper });
  const shell = new Shell({ fs }).use(sedCommands());
  try {
    const result = await shell.exec("sed -i.bak 's/hello/HI/' /nested/work/file");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/nested/work/file"), bytes("HI world\n"));
    assert.deepEqual(await fs.readFile("/nested/work/file.bak"), bytes("hello world\n"));
    assert.equal((await fs.lstat("/nested/work/file")).mode & 0o777, 0o640);
    assert.deepEqual(await lower.readFile("/nested/work/file"), bytes("hello world\n"));
    assert.deepEqual(await lower.readFile("/nested/work/file.bak"), bytes("old backup\n"));
    assert.deepEqual((await upper.readdir("/nested/work")).map(entry => entry.name).sort(), ["file", "file.bak"]);
  } finally { await shell.dispose(); }
});
