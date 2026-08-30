import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_MODES, collectBytes, FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

function code(expected: string) {
  return (error: unknown): boolean => error instanceof FsError && error.code === expected;
}

async function populated() {
  const delegate = new MemoryFileSystem();
  await delegate.mkdir("/directory");
  await delegate.writeFile("/directory/file", new Uint8Array([0, 1, 128, 255]), { mode: 0o755 });
  await delegate.symlink("file", "/directory/symbolic");
  await delegate.link("/directory/file", "/directory/hard");
  return { delegate, filesystem: createReadOnlyFileSystem(delegate) };
}

test("memory conformance: binary reads, directories, metadata, links, and access", async () => {
  const { filesystem } = await populated();
  for (const path of ["/directory/file", "/directory/symbolic", "/directory/hard"]) {
    assert.deepEqual(await filesystem.readFile(path), new Uint8Array([0, 1, 128, 255]));
    assert.equal((await filesystem.stat(path)).type, "file");
    await filesystem.access(path, ACCESS_MODES.R_OK | ACCESS_MODES.X_OK);
    await assert.rejects(filesystem.access(path, ACCESS_MODES.W_OK), code("EROFS"));
  }
  assert.equal((await filesystem.lstat("/directory/symbolic")).type, "symlink");
  assert.equal(await filesystem.readlink("/directory/symbolic"), "file");
  assert.equal(await filesystem.realpath("/directory/symbolic"), "/directory/file");
  assert.equal((await filesystem.stat("/directory/file")).mode, 0o100755);
  assert.deepEqual((await filesystem.readdir("/directory")).map((entry) => entry.name).sort(), ["file", "hard", "symbolic"]);
});

test("memory conformance: delegate limits, streaming ranges, and missing paths", async () => {
  const { filesystem } = await populated();
  await assert.rejects(filesystem.readFile("/directory/file", { maxBytes: 3 }), code("EFBIG"));
  await assert.rejects(filesystem.readFile("/missing"), code("ENOENT"));
  await assert.rejects(filesystem.readFile("/directory"), code("EISDIR"));
  await assert.rejects(filesystem.readlink("/directory/file"), code("EINVAL"));
  const chunks: Uint8Array[] = [];
  for await (const chunk of filesystem.readStream("/directory/file", { start: 1, endExclusive: 4, chunkSize: 2 })) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, [new Uint8Array([1, 128]), new Uint8Array([255])]);
  await assert.rejects(collectBytes(filesystem.readStream("/missing"), { maxBytes: 8 }), code("ENOENT"));
});

test("memory conformance: denied writes cannot mutate files through hard or symbolic aliases", async (context) => {
  let clock = 1000;
  context.mock.method(Date, "now", () => ++clock);
  const { delegate, filesystem } = await populated();
  const beforeFile = await delegate.stat("/directory/file");
  const beforeEntries = await delegate.readdir("/directory");
  const beforeDirectory = await delegate.stat("/directory");
  for (const path of ["/directory/file", "/directory/hard", "/directory/symbolic"]) {
    for (const flag of ["w", "wx", "a", "ax"] as const) {
      await assert.rejects(filesystem.writeFile(path, new Uint8Array([9]), { flag }), code("EROFS"));
    }
    await assert.rejects(filesystem.appendFile(path, new Uint8Array([9])), code("EROFS"));
    await assert.rejects(filesystem.truncate(path), code("EROFS"));
    await assert.rejects(filesystem.chmod(path, 0), code("EROFS"));
    await assert.rejects(filesystem.utimes(path, 0, 0), code("EROFS"));
    await assert.rejects(filesystem.unlink(path), code("EROFS"));
    await assert.rejects(filesystem.copyFile("/missing", path), code("EROFS"));
    await assert.rejects(filesystem.rename(path, "/moved"), code("EROFS"));
  }
  await assert.rejects(filesystem.mkdir("/directory", { recursive: true }), code("EROFS"));
  await assert.rejects(filesystem.rm("/directory", { recursive: true, force: true }), code("EROFS"));
  await assert.rejects(filesystem.rmdir("/directory"), code("EROFS"));
  await assert.rejects(filesystem.symlink("/directory/file", "/new-symbolic"), code("EROFS"));
  await assert.rejects(filesystem.link("/directory/file", "/new-hard"), code("EROFS"));
  assert.deepEqual(await delegate.stat("/directory/file"), beforeFile);
  assert.deepEqual(await delegate.stat("/directory"), beforeDirectory);
  assert.deepEqual(await delegate.readdir("/directory"), beforeEntries);
  assert.deepEqual(await delegate.readFile("/directory/file"), new Uint8Array([0, 1, 128, 255]));
});

test("memory conformance: read results are detached, while external writes remain visible", async () => {
  const { delegate, filesystem } = await populated();
  const snapshot = await filesystem.readFile("/directory/file");
  snapshot.fill(7);
  for await (const chunk of filesystem.readStream("/directory/file", { chunkSize: 1 })) chunk.fill(9);
  assert.deepEqual(await delegate.readFile("/directory/file"), new Uint8Array([0, 1, 128, 255]));
  await delegate.writeFile("/directory/file", new Uint8Array([5]));
  assert.deepEqual(await filesystem.readFile("/directory/symbolic"), new Uint8Array([5]));
  assert.deepEqual(snapshot, new Uint8Array([7, 7, 7, 7]));
});

test("memory conformance: nested wrappers retain readonly behavior and streaming", async () => {
  const { filesystem } = await populated();
  const nested = createReadOnlyFileSystem(createReadOnlyFileSystem(filesystem));
  assert.deepEqual(await collectBytes(nested.readStream("/directory/file"), { maxBytes: 4 }), new Uint8Array([0, 1, 128, 255]));
  assert.deepEqual(nested.capabilities, filesystem.capabilities);
  await assert.rejects(nested.writeFile("/directory/file", new Uint8Array()), code("EROFS"));
});
