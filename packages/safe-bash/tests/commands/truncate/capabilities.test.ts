import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, withoutBlockMetadata, wrapped } from "./helpers.js";

for (const [size, expected] of [["2", 1024], ["+2", 1029], ["-2", 0], ["<2", 5], [">2", 1024], ["/2", 0], ["%2", 1024], ["0", 0]] as const) {
  test(`block units ${size} are scaled before relative arithmetic`, async () => {
    const fs = withoutBlockMetadata(createMemoryFileSystem());
    await fs.writeFile("/file", new Uint8Array(5));
    assert.equal((await run(["-os", size, "file"], fs, { ioBlockSize: () => 512 })).exitCode, 0);
    assert.equal((await fs.stat("/file")).size, expected);
  });
}

for (const size of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid block size ${size} never changes existing contents`, async () => {
    const fs = withoutBlockMetadata(createMemoryFileSystem());
    await fs.writeFile("/file", Uint8Array.of(255));
    assert.equal((await run(["-os1", "file"], fs, { ioBlockSize: () => size })).exitCode, 1);
    assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(255));
  });
}

test("block multiplication and relative extension overflow keep per-file effects", async () => {
  const fs = withoutBlockMetadata(createMemoryFileSystem());
  assert.equal((await run(["-os9223372036854775807", "first", "second"], fs, { ioBlockSize: () => 2 })).stderr,
    "truncate: overflow in 9223372036854775807 * 2 byte blocks for file 'first'\ntruncate: overflow in 9223372036854775807 * 2 byte blocks for file 'second'\n");
  assert.equal((await fs.stat("/first")).size, 0);
  assert.equal((await fs.stat("/second")).size, 0);
  await fs.writeFile("/file", Uint8Array.of(1));
  assert.equal((await run(["-s+9223372036854775807", "file"], fs)).stderr, "truncate: overflow extending size of file 'file'\n");
  assert.equal((await fs.stat("/file")).size, 1);
});

test("exact signed arithmetic can clamp huge negative sizes without allocating", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  assert.equal((await run(["-s-9223372036854775808", "file"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 0);
  const result = await run(["-s9007199254740992", "file"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Operation not supported.*exact filesystem integer range/u);
});

test("large safe-integer lengths reach truncate without buffering or file reads", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  const lengths: number[] = [];
  const host = wrapped(fs, {
    async readFile() { throw new Error("unexpected read"); },
    async writeFile() { throw new Error("unexpected write"); },
    async truncate(_path, length) { lengths.push(length!); },
  });
  assert.equal((await run(["-s9007199254740991", "file"], host)).exitCode, 0);
  assert.deepEqual(lengths, [Number.MAX_SAFE_INTEGER]);
});

test("read-only, mounted capability denial and missing truncate method fail honestly", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  for (const host of [
    wrapped(fs, { capabilities: { ...fs.capabilities, readOnly: true } }),
    wrapped(fs, { async capabilitiesFor() { return { truncate: false }; } }),
    wrapped(fs, { truncate: undefined }),
  ]) {
    assert.equal((await run(["-s0", "file", "new"], host)).exitCode, 1);
    assert.equal((await fs.stat("/file")).size, 1);
    await assert.rejects(fs.stat("/new"), { code: "ENOENT" });
  }
});

test("missing block metadata is unnecessary when no-create skips all operands", async () => {
  assert.deepEqual(await run(["-cos1", "missing"]), { exitCode: 0, stderr: "", stdout: "" });
});

test("reference -s arithmetic supports every mode independent of destination length", async () => {
  for (const [size, length] of [["+2", 7], ["-8", 0], ["<3", 3], [">8", 8], ["/3", 3], ["%3", 6]] as const) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/ref", new Uint8Array(5));
    await fs.writeFile("/file", new Uint8Array(10));
    assert.equal((await run(["-rref", "-s", size, "file"], fs)).exitCode, 0);
    assert.equal((await fs.stat("/file")).size, length);
  }
});

test("no-create dangling symlink and loops retain namespace and fail appropriately", async () => {
  const fs = createMemoryFileSystem();
  await fs.symlink!("absent", "/dangling");
  await fs.symlink!("loop", "/loop");
  assert.equal((await run(["-cs0", "dangling"], fs)).exitCode, 0);
  await assert.rejects(fs.stat("/absent"), { code: "ENOENT" });
  assert.equal((await fs.lstat("/dangling")).type, "symlink");
  assert.match((await run(["-cs0", "loop"], fs)).stderr, /Too many levels of symbolic links/u);
});

test("failure before creation neither swallows errors nor prevents later operands", async () => {
  const fs = createMemoryFileSystem();
  const host = wrapped(fs, { async stat(path, options) {
    if (path === "/denied") throw new FsError("EACCES");
    return fs.stat(path, options);
  } });
  const result = await run(["-s2", "denied", "file"], host);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "truncate: cannot open 'denied' for writing: Permission denied\n");
  assert.equal((await fs.stat("/file")).size, 2);
});

test("cancellation during block-size work prevents truncation and later operands", async () => {
  const fs = withoutBlockMetadata(createMemoryFileSystem()), controller = new AbortController();
  await fs.writeFile("/file", Uint8Array.of(1));
  await assert.rejects(run(["-os2", "file", "later"], fs, { ioBlockSize() {
    controller.abort(new Error("block-size cancelled"));
    return 512;
  } }, { signal: controller.signal }), /block-size cancelled/u);
  assert.equal((await fs.stat("/file")).size, 1);
  await assert.rejects(fs.stat("/later"), { code: "ENOENT" });
});

test("non-regular references require real seek-end semantics, not a stat-size guess", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/directory");
  const missing = await run(["-rdirectory", "file"], fs);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /cannot get the size of 'directory'.*Operation not supported/u);
  await assert.rejects(fs.stat("/file"), { code: "ENOENT" });
  const result = await run(["-rdirectory", "file"], fs, { seekEnd(path, stat, context) {
    assert.equal(path, "/directory");
    assert.equal(stat.type, "directory");
    assert.equal(context.fs, fs);
    return 64;
  } });
  assert.equal(result.exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 64);
});

test("seek-end failures retain path and errno instead of swallowing host failures", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/directory");
  const result = await run(["-rdirectory", "file"], fs, { seekEnd() { throw new FsError("EACCES"); } });
  assert.equal(result.stderr, "truncate: cannot get the size of 'directory': Permission denied\n");
});

test("provider-reported ioBlockSize supplies -o without a command callback", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  const host = wrapped(fs, { async stat(path, options) { return { ...await fs.stat(path, options), ioBlockSize: 512 }; } });
  assert.equal((await run(["-os2", "file"], host)).exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 1024);
});

test("block-size provider failures retain operand and errno", async () => {
  const fs = withoutBlockMetadata(createMemoryFileSystem());
  await fs.writeFile("/file", Uint8Array.of(1));
  const result = await run(["-os1", "file"], fs, { ioBlockSize() { throw new FsError("EACCES"); } });
  assert.equal(result.stderr, "truncate: cannot get the I/O block size of 'file': Permission denied\n");
});

test("canonical block-size metadata is authoritative over the legacy fallback", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  const host = wrapped(fs, { async stat(path, options) { return { ...await fs.stat(path, options), ioBlockSize: 512 }; } });
  assert.equal((await run(["-os2", "file"], host, { ioBlockSize() { throw new Error("fallback must not override canonical metadata"); } })).exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 1024);
});

test("abort observed during a completed truncate still escapes instead of reporting success", async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  await fs.writeFile("/file", Uint8Array.of(1, 2));
  const host = wrapped(fs, { async truncate(path, length, options) {
    await fs.truncate!(path, length, options);
    controller.abort(new Error("truncate completed then aborted"));
  } });
  await assert.rejects(run(["-s1", "file"], host, {}, { signal: controller.signal }), /truncate completed then aborted/u);
  assert.equal((await fs.stat("/file")).size, 1);
});

test("abort during an ENOENT no-create probe is not silently successful", async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  const host = wrapped(fs, { async stat() {
    controller.abort(new Error("no-create probe aborted"));
    throw new FsError("ENOENT");
  } });
  await assert.rejects(run(["-cs1", "missing"], host, {}, { signal: controller.signal }), /no-create probe aborted/u);
});
