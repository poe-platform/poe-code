import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, FsError, toByteSource } from "../../../src/contracts/index.js";
import type { FileSystem, FsOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { OverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { decode, deferred, encode, errno, fixture, immutable, snapshot, wrapped } from "./helpers.js";

test("upper-first reads and merged typed listings do not mutate lower", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.mkdir("/dir");
    await upper.mkdir("/dir");
    await lower.writeFile("/dir/shared", encode("lower"));
    await upper.writeFile("/dir/shared", encode("upper"));
    await lower.writeFile("/dir/lower", encode("lower-only"));
    await upper.mkdir("/dir/upper");
  });
  assert.equal(decode(await overlay.readFile("/dir/shared")), "upper");
  assert.deepEqual(await overlay.readdir("/dir"), [
    { name: "lower", type: "file" }, { name: "shared", type: "file" }, { name: "upper", type: "directory" },
  ]);
  const returned = await overlay.readdir("/dir");
  returned.length = 0;
  assert.equal((await overlay.readdir("/dir")).length, 3);
});

test("whiteouts survive repeated upper recreation and deletion", async (context) => {
  const { overlay, upper } = await fixture(context, async (lower) => { await lower.writeFile("/file", encode("lower")); });
  for (let iteration = 0; iteration < 5; iteration++) {
    await overlay.rm("/file");
    await assert.rejects(overlay.stat("/file"), errno("ENOENT"));
    await overlay.writeFile("/file", encode(`upper-${iteration}`), { flag: "wx" });
    assert.equal(decode(await overlay.readFile("/file")), `upper-${iteration}`);
  }
  assert.equal(decode(await upper.readFile("/file")), "upper-4");
});

test("delete/recreate directories stay opaque at every depth", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.mkdir("/tree/sub", { recursive: true });
    await lower.writeFile("/tree/sub/hidden", encode("lower"));
    await lower.writeFile("/tree/hidden", encode("lower"));
    await lower.writeFile("/tree-other", encode("sibling"));
  });
  await overlay.rm("/tree", { recursive: true });
  await overlay.mkdir("/tree/sub", { recursive: true });
  assert.deepEqual(await overlay.readdir("/tree"), [{ name: "sub", type: "directory" }]);
  assert.deepEqual(await overlay.readdir("/tree/sub"), []);
  await assert.rejects(overlay.readFile("/tree/sub/hidden"), errno("ENOENT"));
  assert.equal(decode(await overlay.readFile("/tree-other")), "sibling");
});

test("lower parents copy up with mode and untouched file metadata", async (context) => {
  const { overlay, upper } = await fixture(context, async (lower) => {
    await lower.mkdir("/parent/sub", { recursive: true, mode: 0o750 });
    await lower.writeFile("/parent/sub/file", encode("lower"), { mode: 0o640 });
    await lower.utimes("/parent/sub/file", 123, 456);
  });
  await overlay.chmod("/parent/sub/file", 0o600);
  assert.equal((await upper.stat("/parent")).mode & 0o7777, 0o750);
  assert.equal((await upper.stat("/parent/sub")).mode & 0o7777, 0o750);
  assert.equal((await upper.stat("/parent/sub/file")).mtimeMs, 456);
  assert.equal(decode(await upper.readFile("/parent/sub/file")), "lower");
});

test("lower links read upper replacements and writes copy up overlay targets", async (context) => {
  const { overlay, upper } = await fixture(context, async (lower, upper) => {
    await lower.mkdir("/target");
    await lower.writeFile("/target/file", encode("lower"));
    await lower.symlink("/target", "/alias");
    await upper.mkdir("/target");
    await upper.writeFile("/target/file", encode("upper"));
  });
  assert.equal(decode(await overlay.readFile("/alias/file")), "upper");
  await overlay.appendFile("/alias/file", encode("!"));
  assert.equal(decode(await upper.readFile("/target/file")), "upper!");
  await assert.rejects(upper.lstat("/alias"), errno("ENOENT"));
  await overlay.rm("/target/file");
  await assert.rejects(overlay.readFile("/alias/file"), errno("ENOENT"));
  await overlay.writeFile("/alias/file", encode("new"));
  assert.equal(decode(await overlay.readFile("/target/file")), "new");
});

test("upper links cannot bypass lower target whiteouts", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.writeFile("/target", encode("secret"));
    await upper.symlink("/target", "/alias");
  });
  await overlay.rm("/target");
  await assert.rejects(overlay.readFile("/alias"), errno("ENOENT"));
  await assert.rejects(overlay.writeFile("/alias", encode("bad"), { flag: "wx" }), errno("EEXIST"));
  await assert.rejects(overlay.writeFile("/alias", encode("unprovable")), errno("ENOENT"));
  await overlay.writeFile("/target", encode("created directly"));
  await overlay.writeFile("/alias", encode("new"));
  assert.equal(decode(await overlay.readFile("/target")), "new");
});

test("shadowed lower symlink directories never contribute children", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.mkdir("/secret/deep", { recursive: true });
    await lower.writeFile("/secret/deep/file", encode("hidden"));
    await lower.symlink("/secret", "/shadow");
    await upper.mkdir("/shadow/deep", { recursive: true });
  });
  assert.deepEqual(await overlay.readdir("/shadow/deep"), []);
  await assert.rejects(overlay.readFile("/shadow/deep/file"), errno("ENOENT"));
});

test("lower path probing stops before any shadowed symlink ancestor", async () => {
  const backing = new MemoryFileSystem();
  const upper = new MemoryFileSystem();
  await backing.mkdir("/secret/deep", { recursive: true });
  await backing.symlink("/secret", "/shadow");
  await upper.mkdir("/shadow/deep", { recursive: true });
  const lower = wrapped(immutable(backing).lower, {
    lstat: async (path, options) => {
      assert.ok(!path.startsWith("/shadow/"), `unsafe backend path: ${path}`);
      return backing.lstat(path, options);
    },
  });
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.stat("/shadow/deep/missing"), errno("ENOENT"));
});

test("symlink loops spanning both layers are bounded", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.symlink("/upper", "/lower");
    await upper.symlink("/lower", "/upper");
  });
  await assert.rejects(overlay.stat("/lower"), errno("ELOOP"));
  await assert.rejects(overlay.writeFile("/lower", encode("bad")), errno("ELOOP"));
  assert.equal((await overlay.lstat("/lower")).type, "symlink");
  await overlay.rm("/lower");
  await assert.rejects(overlay.stat("/upper"), errno("ENOENT"));
});

test("renaming a lower symlink moves the link, not its target", async (context) => {
  const { overlay, backing } = await fixture(context, async (lower) => {
    await lower.writeFile("/target", encode("value"));
    await lower.symlink("/target", "/link");
  });
  const before = await backing.lstat("/link");
  await overlay.rename("/link", "/moved");
  assert.equal(await overlay.readlink("/moved"), "/target");
  const after = await overlay.lstat("/moved");
  for (const key of ["mode", "atimeMs", "mtimeMs"] as const) assert.equal(after[key], before[key]);
  await assert.rejects(overlay.lstat("/link"), errno("ENOENT"));
  assert.equal(decode(await overlay.readFile("/target")), "value");
});

test("merged directory rename preserves whiteouts without resurrection", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.mkdir("/tree/sub", { recursive: true });
    await lower.writeFile("/tree/deleted", encode("hidden"));
    await lower.writeFile("/tree/sub/deleted", encode("hidden"));
    await lower.writeFile("/tree/sub/visible", encode("lower"));
    await upper.mkdir("/tree");
    await upper.writeFile("/tree/upper", encode("upper"));
    await lower.mkdir("/destination");
    await lower.writeFile("/destination/old", encode("hidden destination"));
  });
  await overlay.rm("/tree/deleted");
  await overlay.rm("/tree/sub/deleted");
  await overlay.rm("/destination/old");
  await overlay.rename("/tree", "/destination");
  assert.deepEqual(await overlay.readdir("/destination"), [{ name: "sub", type: "directory" }, { name: "upper", type: "file" }]);
  assert.deepEqual(await overlay.readdir("/destination/sub"), [{ name: "visible", type: "file" }]);
  assert.equal(decode(await overlay.readFile("/destination/sub/visible")), "lower");
  await overlay.mkdir("/tree/sub", { recursive: true });
  assert.deepEqual(await overlay.readdir("/tree/sub"), []);
  await overlay.rm("/destination", { recursive: true });
  await overlay.mkdir("/destination");
  assert.deepEqual(await overlay.readdir("/destination"), []);
});

test("multiple directory moves and recreation never reveal old lower children", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.mkdir("/one/sub", { recursive: true });
    await lower.writeFile("/one/sub/file", encode("value"));
    await lower.writeFile("/one/sub/removed", encode("hidden"));
  });
  await overlay.rm("/one/sub/removed");
  await overlay.rename("/one", "/two");
  await overlay.rename("/two/sub", "/three");
  await overlay.rename("/three", "/one");
  assert.deepEqual(await overlay.readdir("/one"), [{ name: "file", type: "file" }]);
  await overlay.rm("/one/file");
  await overlay.mkdir("/two/sub");
  assert.deepEqual(await overlay.readdir("/two/sub"), []);
  assert.deepEqual(await overlay.readdir("/one"), []);
});

test("whiteout state is instance-local, explicitly not a persistent format", async (context) => {
  const { overlay, upper, lower } = await fixture(context, async (backing) => { await backing.writeFile("/file", encode("lower")); });
  await overlay.rm("/file");
  await assert.rejects(overlay.stat("/file"), errno("ENOENT"));
  const reopened = new OverlayFileSystem({ upper, lower });
  assert.equal(decode(await reopened.readFile("/file")), "lower");
});

for (const failure of ["write", "chmod", "utimes", "publish"] as const) {
  test(`failed ${failure} keeps old content and allows retry`, async () => {
    const backing = new MemoryFileSystem();
    const storage = new MemoryFileSystem();
    await backing.writeFile("/file", encode("old"));
    const before = await snapshot(backing);
    const { lower, mutations } = immutable(backing);
    let broken = true;
    const upper = wrapped(storage, {
      writeFile: async (path, data, options) => {
        await storage.writeFile(path, data, options);
        if (broken && failure === "write") throw new FsError("ENOSPC");
      },
      chmod: async (path, permissions, options) => {
        await storage.chmod(path, permissions, options);
        if (broken && failure === "chmod") throw new FsError("EIO");
      },
      utimes: async (path, atimeMs, mtimeMs, options) => {
        await storage.utimes(path, atimeMs, mtimeMs, options);
        if (broken && failure === "utimes") throw new FsError("EIO");
      },
      rename: async (source, destination, options) => {
        if (broken && failure === "publish" && destination === "/file") throw new FsError("EIO");
        await storage.rename(source, destination, options);
      },
    });
    const overlay = new OverlayFileSystem({ upper, lower });
    await assert.rejects(overlay.appendFile("/file", encode("!")), errno(failure === "write" ? "ENOSPC" : "EIO"));
    assert.equal(decode(await overlay.readFile("/file")), "old");
    assert.deepEqual(await storage.readdir("/"), []);
    broken = false;
    await overlay.appendFile("/file", encode("!"));
    assert.equal(decode(await overlay.readFile("/file")), "old!");
    assert.deepEqual(mutations, []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("failed rename materialization keeps source tree and deleted children hidden", async () => {
  const backing = new MemoryFileSystem();
  const storage = new MemoryFileSystem();
  await backing.mkdir("/tree");
  await backing.writeFile("/tree/first", encode("one"));
  await backing.writeFile("/tree/second", encode("two"));
  await backing.writeFile("/tree/deleted", encode("hidden"));
  const before = await snapshot(backing);
  const { lower, mutations } = immutable(backing);
  let broken = true;
  const upper = wrapped(storage, {
    rename: async (source, destination, options) => {
      if (broken && destination === "/tree/second") throw new FsError("EIO");
      await storage.rename(source, destination, options);
    },
  });
  const overlay = new OverlayFileSystem({ upper, lower });
  await overlay.rm("/tree/deleted");
  await assert.rejects(overlay.rename("/tree", "/moved"), errno("EIO"));
  assert.deepEqual(await overlay.readdir("/tree"), [{ name: "first", type: "file" }, { name: "second", type: "file" }]);
  await assert.rejects(overlay.stat("/moved"), errno("ENOENT"));
  broken = false;
  await overlay.rename("/tree", "/moved");
  assert.equal(decode(await overlay.readFile("/moved/second")), "two");
  await assert.rejects(overlay.stat("/moved/deleted"), errno("ENOENT"));
  assert.deepEqual(mutations, []);
  assert.deepEqual(await snapshot(backing), before);
});

test("failed final rename leaves both source and destination intact", async () => {
  const lower = new MemoryFileSystem();
  const storage = new MemoryFileSystem();
  await lower.writeFile("/source", encode("source"));
  await lower.writeFile("/destination", encode("destination"));
  let broken = true;
  const upper = wrapped(storage, {
    rename: async (source, destination, options) => {
      if (broken && source === "/source" && destination === "/destination") throw new FsError("EIO");
      await storage.rename(source, destination, options);
    },
  });
  const overlay = new OverlayFileSystem({ upper, lower: immutable(lower).lower });
  await assert.rejects(overlay.rename("/source", "/destination"), errno("EIO"));
  assert.equal(decode(await overlay.readFile("/source")), "source");
  assert.equal(decode(await overlay.readFile("/destination")), "destination");
  broken = false;
  await overlay.rename("/source", "/destination");
  assert.equal(decode(await overlay.readFile("/destination")), "source");
});

test("cleanup failure cannot expose staging or undo committed whiteouts", async () => {
  const storage = new MemoryFileSystem();
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", encode("lower"));
  let broken = true;
  const upper = wrapped(storage, {
    rm: async (path, options) => {
      if (broken && path.startsWith("/.virtual-bash-overlay-")) throw new FsError("EIO");
      await storage.rm(path, options);
    },
  });
  const overlay = new OverlayFileSystem({ upper, lower: immutable(backing).lower });
  await overlay.writeFile("/file", encode("upper"));
  await overlay.rm("/file");
  assert.deepEqual(await overlay.readdir("/"), []);
  const leaked = (await storage.readdir("/")).map((entry) => entry.name);
  assert.ok(leaked.length > 0);
  for (const name of leaked) {
    await assert.rejects(overlay.stat(`/${name}`), errno("ENOENT"));
    await assert.rejects(overlay.mkdir(`/${name}`), errno("EBUSY"));
    await assert.rejects(overlay.writeFile(`/${name}`, encode("hijack")), errno("EBUSY"));
  }
  await assert.rejects(overlay.cleanup(), AggregateError);
  broken = false;
  await overlay.cleanup();
  assert.deepEqual(await storage.readdir("/"), []);
  await assert.rejects(overlay.stat("/file"), errno("ENOENT"));
});

test("read errors are not interpreted as absence or permission to create", async () => {
  const upper = new MemoryFileSystem();
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", encode("value"));
  const lower = wrapped(immutable(backing).lower, { lstat: async (path, options) => {
    if (path === "/file") throw new FsError("EACCES");
    return backing.lstat(path, options);
  } });
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.writeFile("/file", encode("bad"), { flag: "wx" }), errno("EACCES"));
  assert.deepEqual(await upper.readdir("/"), []);
});

test("optional capabilities reject unsupported operations honestly", async () => {
  const storage = new MemoryFileSystem();
  const upper = wrapped(storage, { capabilities: { atomicRename: false } });
  const lower = new MemoryFileSystem();
  await lower.writeFile("/file", encode("value"));
  const overlay = new OverlayFileSystem({ upper, lower });
  assert.equal(overlay.capabilities.atomicRename, false);
  assert.equal(overlay.capabilities.readOnly, true);
  assert.equal(overlay.capabilities.hardlinks, false);
  assert.equal(overlay.capabilities.permissions, false);
  assert.equal(overlay.capabilities.timestamps, false);
  assert.equal(overlay.capabilities.symlinks, false);
  assert.equal(decode(await overlay.readFile("/file")), "value");
  await assert.rejects(overlay.writeFile("/file", encode("bad")), errno("ENOTSUP"));
  await assert.rejects(overlay.rename("/file", "/new"), errno("ENOTSUP"));
  await assert.rejects(overlay.rm("/file"), errno("ENOTSUP"));
  await assert.rejects(overlay.link("/file", "/new"), errno("ENOTSUP"));
  assert.deepEqual(await storage.readdir("/"), []);
});

test("read-only upper allows overlay reads but rejects modifications", async () => {
  const upper = immutable(new MemoryFileSystem()).lower;
  const lower = new MemoryFileSystem();
  await lower.writeFile("/file", encode("value"));
  const overlay = new OverlayFileSystem({ upper, lower });
  assert.equal(overlay.capabilities.readOnly, true);
  assert.equal(decode(await overlay.readFile("/file")), "value");
  await assert.rejects(overlay.appendFile("/file", encode("bad")), errno("EROFS"));
});

test("missing upper timestamp method refuses metadata-losing copy-up", async () => {
  const backing = new MemoryFileSystem();
  const storage = new MemoryFileSystem();
  await backing.writeFile("/file", encode("value"));
  const upper = new Proxy(storage, { get(target, property) {
    if (property === "utimes") return undefined;
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const overlay = new OverlayFileSystem({ upper, lower: immutable(backing).lower });
  assert.equal(overlay.capabilities.timestamps, false);
  await assert.rejects(overlay.appendFile("/file", encode("bad")), errno("ENOTSUP"));
  assert.equal(decode(await overlay.readFile("/file")), "value");
  assert.deepEqual(await storage.readdir("/"), []);
});

test("copy-up rejects hardlinked files rather than breaking aliases", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.writeFile("/one", encode("value"));
    await lower.link("/one", "/two");
  });
  await assert.rejects(overlay.appendFile("/one", encode("bad")), errno("ENOTSUP"));
  await assert.rejects(overlay.rename("/one", "/three"), errno("ENOTSUP"));
  assert.equal(decode(await overlay.readFile("/two")), "value");
});

test("per-file limits cover writes, reads, appends, truncates, and copy-up", async (context) => {
  const { overlay } = await fixture(context, async (lower) => { await lower.writeFile("/file", encode("12345")); }, 4);
  await assert.rejects(overlay.readFile("/file"), errno("EFBIG"));
  await assert.rejects(overlay.writeFile("/large", encode("12345")), errno("EFBIG"));
  await assert.rejects(overlay.writeFile("/file", encode("x")), errno("EFBIG"));
  await assert.rejects(overlay.truncate("/file", 5), errno("EFBIG"));
  await overlay.writeFile("/small", encode("123"));
  await assert.rejects(overlay.appendFile("/small", encode("45")), errno("EFBIG"));
  await assert.rejects(overlay.readFile("/small", { maxBytes: 2 }), errno("EFBIG"));
  await assert.rejects(overlay.writeStream("/small", toByteSource("12345")), errno("EFBIG"));
  assert.equal(decode(await overlay.readFile("/small")), "123");
});

test("a failed stream never publishes even its first chunk", async (context) => {
  const { overlay } = await fixture(context, async (lower) => { await lower.writeFile("/file", encode("old")); });
  const failure = new Error("source failed");
  await assert.rejects(overlay.writeStream("/file", (async function* () { yield encode("partial"); throw failure; })()), (error: unknown) => error === failure);
  assert.equal(decode(await overlay.readFile("/file")), "old");
  await assert.rejects(overlay.writeStream("/new", (async function* () { yield "not bytes" as unknown as Uint8Array; })()), TypeError);
  await assert.rejects(overlay.stat("/new"), errno("ENOENT"));
});

test("source may call overlay; exclusive stream existence is rechecked", async (context) => {
  const { overlay } = await fixture(context);
  await assert.rejects(overlay.writeStream("/file", (async function* () {
    await overlay.writeFile("/file", encode("winner"));
    yield encode("loser");
  })(), { flag: "wx" }), errno("EEXIST"));
  assert.equal(decode(await overlay.readFile("/file")), "winner");
});

test("concurrent appends and exclusive creates serialize without lost updates", async (context) => {
  const { overlay } = await fixture(context, async (lower) => { await lower.writeFile("/file", encode("start")); });
  await Promise.all(Array.from({ length: 30 }, () => overlay.writeStream("/file", toByteSource("!"), { flag: "a" })));
  assert.equal(decode(await overlay.readFile("/file")), `start${"!".repeat(30)}`);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => overlay.writeFile("/exclusive", encode("one"), { flag: "wx" })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.ok(errno("EEXIST")(result.reason));
});

test("stalled source cancellation is prompt and releases its iterator", async (context) => {
  const { overlay } = await fixture(context, async (lower) => { await lower.writeFile("/file", encode("old")); });
  const started = deferred<void>();
  const never = deferred<IteratorResult<Uint8Array>>();
  let returned = false;
  const source = { [Symbol.asyncIterator]() { return {
    next: () => { started.resolve(); return never.promise; },
    return: async () => { returned = true; return { done: true as const, value: undefined }; },
  }; } };
  const controller = new AbortController();
  const writing = overlay.writeStream("/file", source, { signal: controller.signal });
  await started.promise;
  controller.abort(new Error("cancel stream"));
  await assert.rejects(writing, (error: unknown) => error === controller.signal.reason);
  await Promise.resolve();
  assert.ok(returned);
  assert.equal(decode(await overlay.readFile("/file")), "old");
});

test("cancellation during staged mutation preserves original and passes signal", async () => {
  const controller = new AbortController();
  const storage = new MemoryFileSystem();
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", encode("old"));
  const upper = wrapped(storage, { writeFile: async (path, data, options) => {
    assert.equal(options?.signal, controller.signal);
    await storage.writeFile(path, data, options);
    controller.abort(new Error("cancel staged write"));
  } });
  const overlay = new OverlayFileSystem({ upper, lower: immutable(backing).lower });
  await assert.rejects(overlay.writeFile("/file", encode("new"), { signal: controller.signal }), (error: unknown) => error === controller.signal.reason);
  assert.equal(decode(await overlay.readFile("/file")), "old");
  assert.deepEqual(await storage.readdir("/"), []);
});

test("queued cancellation rejects promptly without releasing the active writer", async () => {
  const storage = new MemoryFileSystem();
  const started = deferred<void>();
  const unblock = deferred<void>();
  let blocking = true;
  const upper = wrapped(storage, { writeFile: async (path, data, options) => {
    if (blocking) {
      blocking = false;
      started.resolve();
      await unblock.promise;
    }
    await storage.writeFile(path, data, options);
  } });
  const overlay = new OverlayFileSystem({ upper, lower: new MemoryFileSystem() });
  const writer = overlay.writeFile("/first", encode("first"));
  await started.promise;
  const controller = new AbortController();
  const queued = overlay.writeFile("/canceled", encode("bad"), { signal: controller.signal });
  const next = overlay.writeFile("/second", encode("second"));
  controller.abort(new Error("cancel queued request"));
  await assert.rejects(queued, (error: unknown) => error === controller.signal.reason);
  await assert.rejects(storage.stat("/second"), errno("ENOENT"));
  unblock.resolve();
  await Promise.all([writer, next]);
  assert.deepEqual(await overlay.readdir("/"), [{ name: "first", type: "file" }, { name: "second", type: "file" }]);
});

test("aborting parent copy-up does not publish a lower-only deletion", async () => {
  const storage = new MemoryFileSystem();
  const backing = new MemoryFileSystem();
  const controller = new AbortController();
  await backing.mkdir("/parent");
  await backing.writeFile("/parent/file", encode("value"));
  const upper = wrapped(storage, { rename: async (source, destination, options) => {
    await storage.rename(source, destination, options);
    if (destination === "/parent") controller.abort(new Error("cancel after parent copy-up"));
  } });
  const overlay = new OverlayFileSystem({ upper, lower: immutable(backing).lower });
  await assert.rejects(overlay.rm("/parent/file", { signal: controller.signal }), (error: unknown) => error === controller.signal.reason);
  assert.equal(decode(await overlay.readFile("/parent/file")), "value");
});

test("truncate uses its bounded fallback when upper has no truncate method", async () => {
  const storage = new MemoryFileSystem();
  const upper = new Proxy(storage, { get(target, property) {
    if (property === "truncate") return undefined;
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const overlay = new OverlayFileSystem({ upper, lower: new MemoryFileSystem() });
  await overlay.writeFile("/file", encode("value"));
  await overlay.truncate("/file", 7);
  assert.deepEqual(await overlay.readFile("/file"), new Uint8Array([118, 97, 108, 117, 101, 0, 0]));
});

test("copy-up refuses unknown link counts from a hardlink-capable backend", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", encode("value"));
  const lower = wrapped(immutable(backing).lower, { lstat: async (path, options) => {
    const { nlink: ignoredOmitted, ...stat } = await backing.lstat(path, options);
    return stat;
  } });
  const upper = new MemoryFileSystem();
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.appendFile("/file", encode("bad")), errno("ENOTSUP"));
  assert.deepEqual(await upper.readdir("/"), []);
});

test("read-stream output stays isolated from later writes and yielded chunk edits", async (context) => {
  const { overlay } = await fixture(context);
  await overlay.writeFile("/file", encode("123456"));
  const iterator = overlay.readStream("/file", { chunkSize: 2 })[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.ok(!first.done);
  first.value.fill(0);
  await overlay.writeFile("/file", encode("changed"));
  const second = await iterator.next();
  assert.ok(!second.done);
  assert.equal(decode(second.value), "34");
  assert.equal(decode(await overlay.readFile("/file")), "changed");
  await iterator.return?.();
});

const preaborted: Record<string, (overlay: OverlayFileSystem, options: FsOptions) => Promise<unknown>> = {
  readFile: (overlay, options) => overlay.readFile("/file", options),
  writeFile: (overlay, options) => overlay.writeFile("/file", encode("bad"), options),
  appendFile: (overlay, options) => overlay.appendFile("/file", encode("bad"), options),
  stat: (overlay, options) => overlay.stat("/file", options),
  lstat: (overlay, options) => overlay.lstat("/file", options),
  readdir: (overlay, options) => overlay.readdir("/", options),
  mkdir: (overlay, options) => overlay.mkdir("/new", options),
  rm: (overlay, options) => overlay.rm("/file", options),
  rename: (overlay, options) => overlay.rename("/file", "/new", options),
  copyFile: (overlay, options) => overlay.copyFile("/file", "/new", options),
  realpath: (overlay, options) => overlay.realpath("/file", options),
  access: (overlay, options) => overlay.access("/file", 0, options),
  readlink: (overlay, options) => overlay.readlink("/link", options),
  symlink: (overlay, options) => overlay.symlink("/file", "/new", options),
  link: (overlay, options) => overlay.link("/file", "/new", options),
  chmod: (overlay, options) => overlay.chmod("/file", 0o600, options),
  utimes: (overlay, options) => overlay.utimes("/file", 0, 0, options),
  truncate: (overlay, options) => overlay.truncate("/file", 0, options),
  readStream: (overlay, options) => collectBytes(overlay.readStream("/file", options), { maxBytes: 100 }),
  writeStream: (overlay, options) => overlay.writeStream("/file", toByteSource("bad"), options),
  cleanup: (overlay, options) => overlay.cleanup(options),
};

for (const [name, operation] of Object.entries(preaborted)) {
  test(`pre-aborted ${name} rejects without modifying either backend`, async (context) => {
    const { overlay, upper } = await fixture(context, async (lower) => {
      await lower.writeFile("/file", encode("old"));
      await lower.symlink("/file", "/link");
    });
    const signal = AbortSignal.abort(new Error("cancel"));
    await assert.rejects(operation(overlay, { signal }), (error: unknown) => error === signal.reason);
    assert.deepEqual(await upper.readdir("/"), []);
  });
}

test("bounded deterministic operation sequences match a single memory namespace", async (context) => {
  const reference = new MemoryFileSystem();
  const seed = async (backend: FileSystem): Promise<void> => {
    for (const path of ["/one", "/two", "/three"]) {
      await backend.mkdir(path);
      await backend.writeFile(`${path}/seed`, encode(path));
    }
  };
  const { overlay } = await fixture(context, async (lower) => { await seed(lower); });
  await seed(reference);
  const visible = async (backend: FileSystem, path = "/"): Promise<unknown> => {
    const stat = await backend.lstat(path);
    if (stat.type === "file") return [...await backend.readFile(path)];
    const entries: Record<string, unknown> = {};
    for (const child of await backend.readdir(path)) entries[child.name] = await visible(backend, path === "/" ? `/${child.name}` : `${path}/${child.name}`);
    return entries;
  };
  let state = 87233;
  const next = (limit: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; };
  const paths = ["/one", "/two", "/three", "/four"];
  for (let iteration = 0; iteration < 180; iteration++) {
    const parent = paths[next(paths.length)]!;
    const other = paths[next(paths.length)]!;
    const path = `${parent}/file-${next(4)}`;
    const choice = next(7);
    const operation = async (backend: FileSystem): Promise<string> => {
      try {
        if (choice === 0) await backend.writeFile(path, encode(`value-${iteration}`));
        if (choice === 1) await backend.appendFile(path, encode("!"));
        if (choice === 2) await backend.rm(path, { force: true });
        if (choice === 3) await backend.mkdir(parent, { recursive: true });
        if (choice === 4) await backend.rename(parent, other);
        if (choice === 5) await backend.rm(parent, { recursive: true, force: true });
        if (choice === 6) await backend.copyFile(path, `${other}/copied`);
        return "success";
      } catch (error) { if (error instanceof FsError) return error.code; throw error; }
    };
    assert.equal(await operation(overlay), await operation(reference), `operation ${iteration}: ${choice} ${path} ${other}`);
    assert.deepEqual(await visible(overlay), await visible(reference), `namespace after operation ${iteration}`);
  }
});
