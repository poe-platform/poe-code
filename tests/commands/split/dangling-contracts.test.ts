import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FsError, type FileStat, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { chunks, run, wrapped } from "./helpers.js";

async function text(fs: FileSystem, path: string): Promise<string> {
  return Buffer.from(await fs.readFile(path)).toString();
}

function without(fs: FileSystem, method: keyof FileSystem): FileSystem {
  const bound = wrapped(fs, {});
  return new Proxy(bound, { get(target, key) { return key === method ? undefined : Reflect.get(target, key); } });
}

for (const backend of ["memory", "explicit-root-real"]) {
  async function withFs(action: (fs: FileSystem) => Promise<void>): Promise<void> {
    const root = backend === "explicit-root-real" ? await mkdtemp(fileURLToPath(new URL(".native-dangling-contract-", import.meta.url))) : undefined;
    try { await action(root ? await createRealFileSystem({ root }) : createMemoryFileSystem()); }
    finally { if (root) await rm(root, { recursive: true }); }
  }

  test(`${backend}: dangling stdin and writeFile fallback use exclusive resolved target`, async () => {
    for (const streaming of [true, false]) await withFs(async fs => {
      await fs.symlink!("target", "/xaa");
      const writes: unknown[] = [];
      const observed = wrapped(fs, {
        async writeStream(path, source, options) {
          writes.push([path, options?.flag]);
          return fs.writeStream!(path, source, options);
        },
        async writeFile(path, bytes, options) {
          writes.push([path, options?.flag]);
          return fs.writeFile(path, bytes, options);
        },
      });
      const result = await run(["-b2"], "abc", {}, { fs: streaming ? observed : without(observed, "writeStream") });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(writes, [["/target", "wx"], ["/xab", "wx"]]);
      assert.equal(await fs.readlink!("/xaa"), "target");
      assert.equal(await text(fs, "/target"), "ab");
      assert.equal(await text(fs, "/xab"), "c");
    });
  });

  test(`${backend}: target insertion at exclusive write preserves raced data and aliases`, async () => {
    for (const insertion of ["file", "symlink", "hardlink"]) await withFs(async fs => {
      await fs.writeFile("/input", Buffer.from("abcdef"));
      await fs.symlink!("target", "/xaa");
      const racing = wrapped(fs, { async writeStream(path, source, options) {
        assert.equal(path, "/target");
        assert.equal(options?.flag, "wx");
        if (insertion === "file") await fs.writeFile(path, Buffer.from("RACED"));
        else if (insertion === "symlink") await fs.symlink!("input", path);
        else await fs.link!("/input", path);
        return fs.writeStream!(path, source, options);
      } });
      const result = await run(["-b2", "input"], "", {}, { fs: racing });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /file already exists/);
      assert.equal(await text(fs, "/input"), "abcdef");
      assert.equal(await text(fs, "/target"), insertion === "file" ? "RACED" : "abcdef");
      assert.equal(await fs.readlink!("/xaa"), "target");
      if (insertion === "symlink") assert.equal(await fs.readlink!("/target"), "input");
      await assert.rejects(fs.lstat("/xab"), { code: "ENOENT" });
    });
  });

  test(`${backend}: alias inserted during target resolution is checked before input acquisition`, async () => withFs(async fs => {
    await fs.writeFile("/input", Buffer.from("abcdef"));
    await fs.symlink!("target", "/xaa");
    let read = false;
    const racing = wrapped(fs, {
      async readlink(path, options) {
        const target = await fs.readlink!(path, options);
        await fs.link!("/input", "/target", options);
        return target;
      },
      readStream() { read = true; throw new Error("input must not be acquired"); },
    });
    const result = await run(["-b2", "input"], "", {}, { fs: racing });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /would overwrite input/);
    assert.equal(read, false);
    assert.equal(await text(fs, "/input"), "abcdef");
  }));

  test(`${backend}: subsequent link to newly created target cannot erase earlier output`, async () => withFs(async fs => {
    await fs.symlink!("target", "/xaa");
    await fs.symlink!("target", "/xab");
    const result = await run(["-b2"], "abcdef", {}, { fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /aliases an earlier output/);
    assert.equal(await text(fs, "/target"), "ab");
    assert.equal(await fs.readlink!("/xaa"), "target");
    assert.equal(await fs.readlink!("/xab"), "target");
  }));

  test(`${backend}: dangling current output retains partial bytes after budget failure`, async () => withFs(async fs => {
    await fs.symlink!("first", "/xaa");
    await fs.symlink!("second", "/xab");
    const result = await run(["-b3"], chunks(Buffer.from("abcdefghi"), 1), { limits: { maxOutputBytes: 5 } }, { fs });
    assert.equal(result.exitCode, 1);
    if (backend === "explicit-root-real") assert.equal(result.stderr, "split: file too large, writeStream '/second'\n");
    else assert.match(result.stderr, /output limit/);
    assert.equal(await text(fs, "/first"), "abc");
    assert.equal(await text(fs, "/second"), "de");
    assert.equal(await fs.readlink!("/xaa"), "first");
    assert.equal(await fs.readlink!("/xab"), "second");
    await assert.rejects(fs.lstat("/xac"), { code: "ENOENT" });
  }));

  test(`${backend}: cancellation during resolved target write preserves completed and partial bytes`, async () => withFs(async fs => {
    await fs.symlink!("first", "/xaa");
    await fs.symlink!("second", "/xab");
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "exact external cancellation" });
    const interrupted = wrapped(fs, { async writeStream(path, source, options) {
      if (path !== "/second") return fs.writeStream!(path, source, options);
      await fs.writeFile(path, new Uint8Array(), options);
      for await (const chunk of source) {
        await fs.appendFile(path, chunk.subarray(0, 1), options);
        controller.abort(reason);
        options?.signal?.throwIfAborted();
      }
    } });
    await assert.rejects(run(["-b3"], "abcdefghi", {}, { fs: interrupted, signal: controller.signal }), error => error === reason);
    assert.equal(await text(fs, "/first"), "abc");
    assert.equal(await text(fs, "/second"), "d");
    assert.equal(await fs.readlink!("/xab"), "second");
    await assert.rejects(fs.lstat("/xac"), { code: "ENOENT" });
  }));
}

test("dangling resolution propagates readlink/realpath errors without creation", async () => {
  for (const method of ["readlink", "realpath"] as const) for (const code of ["EACCES", "EIO", "ENOENT", "ENOTSUP"] as const) {
    const fs = createMemoryFileSystem();
    await fs.symlink("target", "/xaa");
    let writes = 0;
    const observed = wrapped(fs, {
      [method]: async () => { throw new FsError(code, { path: "/authority", syscall: method }); },
      async writeStream() { writes++; throw new Error("must not write"); },
    });
    const result = await run(["-b2"], "abc", {}, { fs: observed });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, `split: ${new FsError(code, { path: "/authority", syscall: method }).message.slice(code.length + 2)}\n`);
    assert.equal(writes, 0);
    assert.equal(await fs.readlink("/xaa"), "target");
    await assert.rejects(fs.lstat("/target"), { code: "ENOENT" });
  }
});

test("missing readlink is a narrow capability gap, not a ban on existing symlinks", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abc"));
  await fs.symlink("target", "/xaa");
  const withoutReadlink = without(fs, "readlink");
  const missing = await run(["-b3", "input"], "", {}, { fs: withoutReadlink });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /cannot resolve dangling output symlink without readlink/);
  await assert.rejects(fs.lstat("/target"), { code: "ENOENT" });
  await fs.writeFile("/target", Buffer.from("OLD"));
  const existing = await run(["-b3", "input"], "", {}, { fs: withoutReadlink });
  assert.equal(existing.exitCode, 0, existing.stderr);
  assert.equal(await text(fs, "/target"), "abc");
});

test("opaque existing symlink identity stays unsupported, while absent targets need no invented identity", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abc"));
  await fs.writeFile("/target", Buffer.from("OLD"));
  await fs.symlink("target", "/xaa");
  const opaque = (stat: FileStat): FileStat => {
    const { identityScope, dev, ino, ...rest } = stat;
    return rest;
  };
  const observed = without(wrapped(fs, {
    async stat(path, options) { return opaque(await fs.stat(path, options)); },
    async lstat(path, options) { return opaque(await fs.lstat(path, options)); },
  }), "compareEntry");
  const existing = await run(["-b3", "input"], "", {}, { fs: observed });
  assert.equal(existing.exitCode, 1);
  assert.match(existing.stderr, /cannot establish/);
  assert.equal(await text(fs, "/target"), "OLD");
  await fs.symlink("new", "/yaa");
  const missing = await run(["-b3", "input", "y"], "", {}, { fs: observed });
  assert.equal(missing.exitCode, 0, missing.stderr);
  assert.equal(await text(fs, "/new"), "abc");
});

test("blocked dangling resolution forwards signal, aborts exactly and observes late rejection", async () => {
  for (const method of ["readlink", "realpath"] as const) {
    const fs = createMemoryFileSystem();
    await fs.symlink("target", "/xaa");
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "cancel is not missing target" });
    let entered!: () => void;
    let rejectHost!: (error: unknown) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const observed = wrapped(fs, { [method]: (_path: string, options?: { signal?: AbortSignal }) => {
      assert.ok(options?.signal);
      entered();
      return new Promise<string>((_resolve, reject) => { rejectHost = reject; });
    } });
    const operation = run(["-b2"], "abc", {}, { fs: observed, signal: controller.signal });
    await started;
    controller.abort(reason);
    await assert.rejects(operation, error => error === reason);
    rejectHost(new Error("late resolution failure"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await fs.readlink("/xaa"), "target");
    await assert.rejects(fs.lstat("/target"), { code: "ENOENT" });
  }
});
