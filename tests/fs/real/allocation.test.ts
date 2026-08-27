import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as native from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../src/contracts/index.js";
import { nativeAllocatedBytes } from "../../../src/fs/real/allocation.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

const largestBlocks = Math.floor(Number.MAX_SAFE_INTEGER / 512);
const invalidBlocks: unknown[] = [
  undefined, null, "1", 1n, {}, -1, -512, NaN, Infinity, -Infinity,
  0.5, 1.5, Number.MAX_SAFE_INTEGER + 1, largestBlocks + 1, Number.MAX_SAFE_INTEGER,
];

for (const platform of ["darwin", "linux"]) {
  test(`${platform}: validates block count and byte-product boundaries without coercion`, () => {
    for (const blocks of [0, 1, 8, largestBlocks]) {
      assert.equal(nativeAllocatedBytes(blocks, platform), Number(BigInt(blocks) * 512n));
    }
    for (const blocks of invalidBlocks) assert.equal(nativeAllocatedBytes(blocks, platform), undefined);
    const hostile = { valueOf() { throw new Error("must not coerce native metadata"); } };
    assert.equal(nativeAllocatedBytes(hostile, platform), undefined);
  });
}

test("undocumented platforms omit allocation, including otherwise valid reported zero", () => {
  for (const platform of ["win32", "freebsd", "openbsd", "aix", "sunos", "", "unknown"]) {
    for (const blocks of [0, 1, largestBlocks, ...invalidBlocks]) {
      assert.equal(nativeAllocatedBytes(blocks, platform), undefined);
    }
  }
});

async function fixture(context: TestContext) {
  const parent = fileURLToPath(new URL("./allocation-evidence/", import.meta.url));
  await native.mkdir(parent, { recursive: true });
  const temporary = await native.mkdtemp(join(parent, ".native-"));
  context.after(async () => {
    await native.rm(temporary, { recursive: true, force: true });
    await assert.rejects(native.lstat(temporary), { code: "ENOENT" });
  });
  const root = await native.realpath(temporary);
  return { root, filesystem: await createRealFileSystem({ root }) };
}

test("Real stat/lstat report native allocation for owned empty, dense, sparse, hardlink, directory and symlink entries", async (context) => {
  const { root, filesystem } = await fixture(context);
  await native.writeFile(join(root, "empty"), new Uint8Array(), { flag: "wx" });
  await native.writeFile(join(root, "dense"), randomBytes(64 * 1024), { flag: "wx" });
  const sparse = await native.open(join(root, "sparse"), "wx");
  try {
    await sparse.truncate(4 * 1024 * 1024);
  } finally { await sparse.close(); }
  const holeWritten = await native.open(join(root, "hole-written"), "wx");
  try {
    const written = await holeWritten.write(randomBytes(4096), 0, 4096, 4 * 1024 * 1024 - 4096);
    assert.equal(written.bytesWritten, 4096);
  } finally { await holeWritten.close(); }
  await native.link(join(root, "dense"), join(root, "hardlink"));
  await native.mkdir(join(root, "directory"));
  await native.symlink("dense", join(root, "symlink"));
  const observations = [];
  for (const name of ["empty", "dense", "sparse", "hole-written", "hardlink", "directory", "symlink"]) {
    for (const method of ["stat", "lstat"] as const) {
      const before = await native[method](join(root, name), { bigint: true });
      const actual = await filesystem[method](`/${name}`);
      const after = await native[method](join(root, name), { bigint: true });
      assert.equal(after.ino, before.ino);
      assert.equal(after.blocks, before.blocks);
      assert.equal(actual.size, Number(before.size));
      assert.equal(actual.ino, Number(before.ino));
      assert.equal(actual.dev, Number(before.dev));
      assert.equal(actual.mode, Number(before.mode));
      const supported = process.platform === "darwin" || process.platform === "linux";
      const bytes = before.blocks * 512n;
      if (supported && before.blocks >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER)) {
        assert.equal(actual.allocatedBytes, Number(bytes));
        assert.equal(Object.hasOwn(actual, "allocatedBytes"), true);
      } else {
        assert.equal(actual.allocatedBytes, undefined);
        assert.equal(Object.hasOwn(actual, "allocatedBytes"), false);
      }
      observations.push({ name, method, type: actual.type, size: actual.size,
        blocks: before.blocks.toString(), allocatedBytes: actual.allocatedBytes ?? null });
    }
  }
  assert.equal((await filesystem.stat("/symlink")).type, "file");
  assert.equal((await filesystem.lstat("/symlink")).type, "symlink");
  assert.equal((await filesystem.stat("/dense")).allocatedBytes, (await filesystem.stat("/hardlink")).allocatedBytes);
  context.diagnostic(JSON.stringify({ node: process.version, platform: process.platform,
    arch: process.arch, uv: process.versions.uv, filesystemType: (await native.statfs(root)).type, observations }));
});

test("Real stat/lstat retain typed missing-path errors rather than unknown-allocation successes", async (context) => {
  const { filesystem } = await fixture(context);
  for (const method of ["stat", "lstat"] as const) {
    await assert.rejects(filesystem[method]("/missing"), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "ENOENT");
      assert.equal(error.path, "/missing");
      assert.equal(error.syscall, method);
      return true;
    });
  }
});

test("Real stat/lstat preserve pre-aborted reasons including errno-shaped cancellation", async (context) => {
  const { root, filesystem } = await fixture(context);
  await native.writeFile(join(root, "file"), "unchanged", { flag: "wx" });
  for (const reason of [new Error("stop allocation observation"), Object.assign(new Error("abort"), { code: "ENOENT" })]) {
    for (const method of ["stat", "lstat"] as const) {
      await assert.rejects(filesystem[method]("/file", { signal: AbortSignal.abort(reason) }), (error) => error === reason);
      await assert.rejects(filesystem[method]("/missing", { signal: AbortSignal.abort(reason) }), (error) => error === reason);
    }
  }
  assert.equal(await native.readFile(join(root, "file"), "utf8"), "unchanged");
});
