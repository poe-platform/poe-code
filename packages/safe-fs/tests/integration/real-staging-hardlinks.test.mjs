import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { RealFileSystem } from "../../src/fs/real/index.ts";

// Explicit native acceptance, separate from memfs-backed unit discovery.
// These same-device fixtures qualify trusted staging publication, not native
// cross-device Shell mv, atomic ancestry, or protection from external writers.
for (const mode of [0o644, 0o444]) {
  test(`native staging preserves hardlinked peers like mv -f, mode=${mode.toString(8)}`, async context => {
    let directory, reader;
    context.after(async () => {
      try { await reader?.close(); }
      finally { if (directory !== undefined) await rm(directory, { recursive: true, force: true }); }
    });
    directory = await mkdtemp(join(tmpdir(), "safe-fs-staging-hardlinks-"));
    const oracle = join(directory, "oracle");
    await mkdir(oracle);
    await writeFile(join(oracle, "source"), new Uint8Array([1, 2, 3]));
    await writeFile(join(oracle, "output"), new Uint8Array([7, 8, 9]));
    await chmod(join(oracle, "output"), mode);
    await link(join(oracle, "output"), join(oracle, "peer"));
    const original = await lstat(join(oracle, "output"));
    assert.equal(original.nlink, 2);
    const result = await promisify(execFile)("/bin/mv", ["-f", join(oracle, "source"), join(oracle, "output")],
      { signal: context.signal, timeout: 10000, maxBuffer: 4096 });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(new Uint8Array(await readFile(join(oracle, "output"))), new Uint8Array([1, 2, 3]));
    assert.deepEqual(new Uint8Array(await readFile(join(oracle, "peer"))), new Uint8Array([7, 8, 9]));
    assert.equal((await lstat(join(oracle, "peer"))).ino, original.ino);
    assert.equal((await lstat(join(oracle, "peer"))).nlink, 1);
    assert.equal((await lstat(join(oracle, "output"))).nlink, 1);

    const fs = new RealFileSystem(directory);
    await fs.mkdir("/work");
    await fs.writeFile("/work/output", new Uint8Array([7, 8, 9]));
    await fs.chmod("/work/output", mode);
    await fs.link("/work/output", "/work/peer");
    const parent = await fs.lstat("/work"), destination = await fs.lstat("/work/output");
    assert.equal(destination.nlink, 2);
    reader = await fs.openReadFile("/work/peer");
    const staged = await fs.createStagedFile("/work/.stage", "entry", { type: "file", data: new Uint8Array([1, 2, 3]) }, { parent });
    await fs.publishStagedFile(staged, "/work/output", { parent, destination });
    await fs.removeStagedFile(staged);
    assert.deepEqual(await fs.readFile("/work/output"), new Uint8Array([1, 2, 3]));
    assert.deepEqual(await fs.readFile("/work/peer"), new Uint8Array([7, 8, 9]));
    assert.deepEqual(await reader.read(0, 3), new Uint8Array([7, 8, 9]));
    const output = await fs.lstat("/work/output"), peer = await fs.lstat("/work/peer");
    assert.equal(output.ino, staged.file.stat.ino);
    assert.equal(output.nlink, 1);
    assert.equal(peer.ino, destination.ino);
    assert.equal(peer.nlink, 1);
    assert.equal(peer.mode & 0o777, mode);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["output", "peer"]);
  });
}
