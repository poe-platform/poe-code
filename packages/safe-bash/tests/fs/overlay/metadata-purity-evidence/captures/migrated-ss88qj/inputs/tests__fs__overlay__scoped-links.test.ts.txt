import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { collectBytes, FsError } from "../../../src/contracts/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { OverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { decode, encode, errno, fixture, immutable, snapshot, wrapped } from "./helpers.js";

const unsupported = (error: unknown): boolean => error instanceof FsError && ["ENOTSUP", "ENOENT", "EACCES"].includes(error.code);

async function scoped(context: TestContext, opaque: boolean, mountedTarget = true, rootTarget = true) {
  const root = new MemoryFileSystem();
  const mounted = new MemoryFileSystem();
  if (rootTarget) await root.writeFile("/file", encode("root value"));
  if (mountedTarget) await mounted.writeFile("/file", encode("mounted value"));
  await mounted.symlink("/file", "/link");
  const rootBefore = await snapshot(root);
  const mountedBefore = await snapshot(mounted);
  const protectedRoot = immutable(root);
  const protectedMounted = immutable(mounted);
  const mount = new MountFileSystem({ root: protectedRoot.lower, mounts: { "/mount": protectedMounted.lower } });
  const lower = opaque ? new ReadOnlyFileSystem(mount) : mount;
  const upper = new MemoryFileSystem();
  const overlay = new OverlayFileSystem({ upper, lower });
  context.after(async () => {
    assert.deepEqual(protectedRoot.mutations, []);
    assert.deepEqual(protectedMounted.mutations, []);
    assert.deepEqual(await snapshot(root), rootBefore);
    assert.deepEqual(await snapshot(mounted), mountedBefore);
  });
  return { overlay, upper, lower };
}

for (const opaque of [false, true]) {
  const name = opaque ? "opaque ReadOnly(Mount)" : "Mount";

  test(`${name}: absolute scoped link never reads the wrong root backend`, async (context) => {
    const { overlay, lower } = await scoped(context, opaque);
    assert.equal(await lower.readlink!("/mount/link"), "/file");
    assert.equal(decode(await lower.readFile("/mount/link")), "mounted value");
    await assert.rejects(overlay.readFile("/mount/link"), unsupported);
    await assert.rejects(overlay.stat("/mount/link"), unsupported);
    await assert.rejects(overlay.realpath("/mount/link"), unsupported);
    assert.equal(decode(await overlay.readFile("/file")), "root value");
    assert.equal((await overlay.lstat("/mount/link")).type, "symlink");
    assert.equal(await overlay.readlink("/mount/link"), "/file");
  });

  test(`${name}: dangling mounted target cannot fall back to existing root data`, async (context) => {
    const { overlay } = await scoped(context, opaque, false);
    await assert.rejects(overlay.readFile("/mount/link"), unsupported);
    await assert.rejects(overlay.writeFile("/mount/link", encode("bad")), unsupported);
    assert.equal(decode(await overlay.readFile("/file")), "root value");
  });

  test(`${name}: upper-only target does not prove an ambiguous link namespace`, async (context) => {
    const { overlay, upper } = await scoped(context, opaque, false, false);
    await upper.writeFile("/file", encode("upper root value"));
    await upper.mkdir("/mount");
    await upper.writeFile("/mount/file", encode("upper mounted value"));
    await assert.rejects(overlay.readFile("/mount/link"), unsupported);
    await assert.rejects(overlay.appendFile("/mount/link", encode("bad")), unsupported);
    assert.equal(decode(await upper.readFile("/file")), "upper root value");
    assert.equal(decode(await upper.readFile("/mount/file")), "upper mounted value");
  });

  test(`${name}: ambiguous lower link cannot acquire new semantics through copy-up`, async (context) => {
    const { overlay, upper } = await scoped(context, opaque);
    await assert.rejects(overlay.rename("/mount/link", "/moved"), unsupported);
    await assert.rejects(upper.lstat("/moved"), errno("ENOENT"));
    await assert.rejects(upper.lstat("/mount/link"), errno("ENOENT"));
    await assert.rejects(overlay.rename("/mount", "/moved-directory"), unsupported);
    await assert.rejects(upper.lstat("/moved-directory"), errno("ENOENT"));
    await assert.rejects(overlay.readFile("/mount/link"), unsupported);
  });

  test(`${name}: followed-link mutations and streams reject before touching root data`, async (context) => {
    const { overlay, upper } = await scoped(context, opaque);
    let consumed = false;
    const operations = [
      () => overlay.writeFile("/mount/link", encode("bad")),
      () => overlay.appendFile("/mount/link", encode("bad")),
      () => overlay.truncate("/mount/link", 0),
      () => overlay.chmod("/mount/link", 0o600),
      () => overlay.utimes("/mount/link", 1, 2),
      () => overlay.copyFile("/mount/link", "/copy"),
      () => overlay.copyFile("/file", "/mount/link"),
      () => overlay.access("/mount/link", 2),
      () => collectBytes(overlay.readStream("/mount/link"), { maxBytes: 100 }),
      () => overlay.writeStream("/mount/link", (async function* () { consumed = true; yield encode("bad"); })()),
    ];
    for (const operation of operations) await assert.rejects(operation(), unsupported);
    assert.equal(consumed, false);
    assert.deepEqual(await upper.readdir("/"), []);
    assert.equal(decode(await overlay.readFile("/file")), "root value");
  });

  test(`${name}: an upper file or provable upper link shadows the ambiguous lower link`, async (context) => {
    const { overlay, upper } = await scoped(context, opaque);
    await upper.mkdir("/mount");
    await upper.writeFile("/mount/link", encode("upper file"));
    assert.equal(decode(await overlay.readFile("/mount/link")), "upper file");
    await upper.rm("/mount/link");
    await upper.writeFile("/target", encode("upper target"));
    await upper.symlink("/target", "/mount/link");
    assert.equal(decode(await overlay.readFile("/mount/link")), "upper target");
    await overlay.appendFile("/mount/link", encode("!"));
    assert.equal(decode(await upper.readFile("/target")), "upper target!");
  });
}

test("matching backend realpaths through an alias cannot authorize a wrong upper override", async () => {
  const storage = new MemoryFileSystem();
  await storage.mkdir("/mount");
  await storage.writeFile("/mount/file", encode("mounted value"));
  await storage.symlink("/mount/file", "/mount/link");
  await storage.symlink("/mount/file", "/file");
  const lower = wrapped(immutable(storage).lower, { readlink: async (path, options) =>
    path === "/mount/link" ? "/file" : storage.readlink(path, options),
  });
  assert.equal(await lower.realpath("/mount/link"), await lower.realpath("/file"));
  const upper = new MemoryFileSystem();
  await upper.writeFile("/file", encode("wrong upper value"));
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.readFile("/mount/link"), unsupported);
  await assert.rejects(overlay.rename("/mount/link", "/copied-link"), unsupported);
  assert.equal(decode(await upper.readFile("/file")), "wrong upper value");
});

test("directory-link suffix traversal cannot escape an opaque mount boundary", async () => {
  const root = new MemoryFileSystem();
  const mounted = new MemoryFileSystem();
  await root.writeFile("/file", encode("root value"));
  await mounted.mkdir("/sub");
  await mounted.symlink("sub", "/link");
  const lower = new ReadOnlyFileSystem(new MountFileSystem({ root, mounts: { "/mount": mounted } }));
  const upper = new MemoryFileSystem();
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.readFile("/mount/link/../../file"), unsupported);
  await assert.rejects(overlay.writeFile("/mount/link/../../file", encode("bad")), unsupported);
  await assert.rejects(overlay.mkdir("/mount/link/../../created", { recursive: true }), unsupported);
  await assert.rejects(upper.lstat("/created"), errno("ENOENT"));
  assert.equal(decode(await root.readFile("/file")), "root value");
});

test("copy-up and repeated relocation retain opaque lower directory-link boundaries", async () => {
  const root = new MemoryFileSystem();
  const mounted = new MemoryFileSystem();
  await mounted.mkdir("/sub");
  await mounted.writeFile("/sub/file", encode("mounted value"));
  await mounted.symlink("sub", "/link");
  const lower = new ReadOnlyFileSystem(new MountFileSystem({ root, mounts: { "/mount": mounted } }));
  const upper = new MemoryFileSystem();
  await upper.writeFile("/file", encode("upper root value"));
  const overlay = new OverlayFileSystem({ upper, lower });
  await overlay.rename("/mount", "/moved");
  assert.equal(decode(await overlay.readFile("/moved/link/file")), "mounted value");
  await assert.rejects(overlay.readFile("/moved/link/../../file"), unsupported);
  await overlay.rename("/moved", "/again");
  assert.equal(decode(await overlay.readFile("/again/link/file")), "mounted value");
  await assert.rejects(overlay.readFile("/again/link/../../file"), unsupported);
});

test("relative symlink relocation rejects an unprovable change to an external target", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.mkdir("/tree");
    await lower.mkdir("/destination");
    await lower.writeFile("/outside", encode("outside"));
    await lower.symlink("../outside", "/tree/link");
  });
  await assert.rejects(overlay.rename("/tree", "/destination/moved"), unsupported);
  assert.equal(await overlay.readlink("/tree/link"), "../outside");
  await assert.rejects(overlay.lstat("/destination/moved"), errno("ENOENT"));
});

test("cancellation at link publication cannot omit its lower validation origin", async () => {
  const root = new MemoryFileSystem();
  const mounted = new MemoryFileSystem();
  await mounted.mkdir("/sub");
  await mounted.symlink("sub", "/link");
  const lower = new ReadOnlyFileSystem(new MountFileSystem({ root, mounts: { "/mount": mounted } }));
  const storage = new MemoryFileSystem();
  await storage.mkdir("/mount/sub", { recursive: true });
  await storage.writeFile("/file", encode("root value"));
  const controller = new AbortController();
  const upper = wrapped(storage, { rename: async (source, destination, options) => {
    await storage.rename(source, destination, options);
    if (destination === "/mount/link") controller.abort(new Error("cancel after publication"));
  } });
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.rename("/mount/link", "/moved", { signal: controller.signal }), (error: unknown) => error === controller.signal.reason);
  assert.equal((await storage.lstat("/mount/link")).type, "symlink");
  await assert.rejects(overlay.readFile("/mount/link/../../file"), unsupported);
  assert.equal(decode(await storage.readFile("/file")), "root value");
});

test("single-root links retain upper precedence, whiteouts, and target copy-up", async (context) => {
  const { overlay, upper } = await fixture(context, async (lower, upper) => {
    await lower.writeFile("/target", encode("lower"));
    await lower.symlink("/target", "/link");
    await upper.writeFile("/target", encode("upper"));
  });
  assert.equal(decode(await overlay.readFile("/link")), "upper");
  await overlay.appendFile("/link", encode("!"));
  assert.equal(decode(await upper.readFile("/target")), "upper!");
  await overlay.rm("/target");
  await assert.rejects(overlay.readFile("/link"), errno("ENOENT"));
  await overlay.writeFile("/link", encode("recreated"));
  assert.equal(decode(await overlay.readFile("/target")), "recreated");
});

test("single-root symlink chains resolve when the backend confirms the final namespace", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.writeFile("/target", encode("value"));
    await lower.symlink("/target", "/second");
    await lower.symlink("/second", "/first");
  });
  assert.equal(decode(await overlay.readFile("/first")), "value");
  await overlay.appendFile("/first", encode("!"));
  assert.equal(decode(await overlay.readFile("/target")), "value!");
});

test("upper symlink override that changes a lower link's unprovable route rejects", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.writeFile("/target", encode("lower"));
    await lower.symlink("/target", "/link");
    await upper.writeFile("/other", encode("upper"));
    await upper.symlink("/other", "/target");
  });
  await assert.rejects(overlay.readFile("/link"), unsupported);
  assert.equal(decode(await overlay.readFile("/target")), "upper");
});

test("dangling and cross-layer-only targets reject until their origin backend can prove them", async (context) => {
  const { overlay } = await fixture(context, async (lower, upper) => {
    await lower.symlink("/upper-only", "/lower-link");
    await upper.writeFile("/upper-only", encode("upper"));
    await lower.writeFile("/lower-only", encode("lower"));
    await upper.symlink("/lower-only", "/upper-link");
  });
  await assert.rejects(overlay.readFile("/lower-link"), unsupported);
  await assert.rejects(overlay.readFile("/upper-link"), unsupported);
  await overlay.symlink("/created-later", "/dangling");
  await assert.rejects(overlay.writeFile("/dangling", encode("bad")), unsupported);
  await overlay.writeFile("/created-later", encode("created"));
  assert.equal(decode(await overlay.readFile("/dangling")), "created");
});

test("backend validation errors cannot fall through to content reads", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", encode("value"));
  await storage.symlink("/file", "/link");
  let reads = 0;
  const lower: FileSystem = wrapped(immutable(storage).lower, {
    realpath: async () => { throw new FsError("EIO"); },
    readFile: async (path, options) => { reads++; return storage.readFile(path, options); },
  });
  const overlay = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower });
  await assert.rejects(overlay.readFile("/link"), errno("EIO"));
  assert.equal(reads, 0);
});

test("backend delegates are private and cannot be replaced through ordinary properties", async () => {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  await upper.writeFile("/file", encode("upper"));
  await lower.writeFile("/file", encode("lower"));
  const overlay = new OverlayFileSystem({ upper, lower });
  assert.equal(Reflect.get(overlay, "upper"), undefined);
  assert.equal(Reflect.get(overlay, "lower"), undefined);
  Reflect.set(overlay, "upper", lower);
  Reflect.set(overlay, "lower", upper);
  assert.equal(decode(await overlay.readFile("/file")), "upper");
});
