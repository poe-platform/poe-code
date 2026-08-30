import assert from "node:assert/strict";
import { test } from "vitest";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { EntryAuthority } from "../../../../src/fs/mount/comparison.js";
import { compareEntries,registerEntryAuthority,registerEntryView,resolveEntryView } from "../../../../src/fs/mount/comparison.js";
import { compareIdentity } from "../../../../src/fs/mount/identity.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { wrapped } from "../overlay/helpers.js";

const bytes = new TextEncoder().encode("source sentinel");
const previous = new TextEncoder().encode("previous target");

function unscoped(backing: FileSystem, overrides: Partial<FileSystem> = {}): FileSystem {
  const stat: FileSystem["stat"] = async (path, options) => {
    const { identityScope: ignoredScope, ...metadata } = await backing.stat(path, options);
    return metadata;
  };
  return wrapped(backing, { ...overrides, stat, lstat: async (path, options) => {
    const { identityScope: ignoredScope, ...metadata } = await backing.lstat(path, options);
    return metadata;
  } });
}

async function fixture(shared = false, leftOverrides: Partial<FileSystem> = {}, rightOverrides: Partial<FileSystem> = {}) {
  const leftStore = createMemoryFileSystem();
  const rightStore = shared ? leftStore : createMemoryFileSystem();
  await leftStore.writeFile("/source", bytes);
  await rightStore.writeFile("/target", previous);
  const left = unscoped(leftStore, leftOverrides);
  const right = unscoped(rightStore, rightOverrides);
  const backing = new Map<FileSystem, FileSystem>([[left, leftStore], [right, rightStore]]);
  const calls: string[] = [];
  const authority: EntryAuthority = async (own, peer, options) => {
    calls.push(`${own.path}:${peer.path}`);
    const ownStore = backing.get(own.filesystem);
    const peerStore = backing.get(peer.filesystem);
    if (!ownStore || !peerStore) return "unknown";
    return compareIdentity(await ownStore.stat(own.path, options), await peerStore.stat(peer.path, options));
  };
  return { leftStore, rightStore, left, right, calls, authority };
}

test("known complete tuples win without querying an advertised authority", async () => {
  const store = createMemoryFileSystem();
  await store.writeFile("/file", bytes);
  await store.link("/file", "/alias");
  const advertised = wrapped(store, {});
  registerEntryAuthority(advertised, async () => { assert.fail("known tuple must not query"); });
  assert.equal(await compareEntries(advertised, "/file", advertised, "/alias"), "same");
});

for (const shared of [false, true]) {
  test(`recognized shared authority permits distinct overwrite, sharedStore=${shared}`, async () => {
    const state = await fixture(shared);
    registerEntryAuthority(state.left, state.authority);
    registerEntryAuthority(state.right, state.authority);
    const mount = createMountFileSystem({ root: state.left, mounts: { "/remote": state.right } });
    await mount.copyFile("/source", "/remote/target");
    assert.deepEqual(state.calls, ["/source:/target"]);
    assert.deepEqual(await state.leftStore.readFile("/source"), bytes);
    assert.deepEqual(await state.rightStore.readFile("/target"), bytes);
  });
}

test("same-mount unknown stat can use its recognized metadata authority", async () => {
  const state = await fixture(true);
  registerEntryAuthority(state.left, state.authority);
  const mount = createMountFileSystem({ root: state.left });
  await mount.copyFile("/source", "/target");
  assert.deepEqual(state.calls, ["/source:/target"]);
  assert.deepEqual(await state.leftStore.readFile("/target"), bytes);
});

test("authority-proven alias fails before source acquisition or writes", async () => {
  const calls: string[] = [];
  const state = await fixture(true, { readStream: () => { calls.push("read"); throw new FsError("EIO"); } },
    { writeStream: async () => { calls.push("write"); throw new FsError("ENOSPC"); } });
  await state.leftStore.link("/source", "/alias");
  registerEntryAuthority(state.left, state.authority);
  registerEntryAuthority(state.right, state.authority);
  const mount = createMountFileSystem({ root: state.left, mounts: { "/other": state.right } });
  await assert.rejects(mount.copyFile("/source", "/other/alias"), { code: "EINVAL", path: "/source", dest: "/other/alias" });
  assert.deepEqual(state.calls, ["/source:/alias"]);
  assert.deepEqual(calls, []);
  assert.deepEqual(await state.leftStore.readFile("/source"), bytes);
});

test("both operands unwrap nested mounts and readonly views without erasing policy", async () => {
  const state = await fixture();
  registerEntryAuthority(state.left, state.authority);
  registerEntryAuthority(state.right, state.authority);
  const left = createReadOnlyFileSystem(createMountFileSystem({ root: state.left }));
  const right = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": state.right } });
  const leftView = await resolveEntryView(left, "/source");
  assert.equal(leftView.filesystem, state.left);
  assert.equal(leftView.readOnly, true);
  assert.equal(await left.compareEntry("/source", right, "/data/target"), "distinct");
  assert.deepEqual(state.calls, ["/source:/target"]);
  await assert.rejects(left.copyFile("/source", "/target"), { code: "EROFS" });
});

test("unrecognized peers stay unknown despite independent adapter objects", async () => {
  const state = await fixture();
  registerEntryAuthority(state.left, state.authority);
  const stranger = unscoped(state.leftStore);
  assert.equal(await compareEntries(state.left, "/source", stranger, "/source"), "unknown");
  assert.deepEqual(state.calls, ["/source:/source"]);
});

for (const answers of [["distinct", "same"], ["invalid", "unknown"]] as const) {
  test(`invalid or conflicting terminal answers fail EIO: ${answers.join("/")}`, async () => {
    const state = await fixture();
    const calls: string[] = [];
    Object.defineProperty(state.left, "compareEntry", { configurable: true, value: async () => { calls.push("left"); return answers[0]; } });
    Object.defineProperty(state.right, "compareEntry", { configurable: true, value: async () => { calls.push("right"); return answers[1]; } });
    const mount = createMountFileSystem({ root: state.left, mounts: { "/other": state.right } });
    await assert.rejects(mount.copyFile("/source", "/other/target"), { code: "EIO" });
    assert.deepEqual(calls, answers[0] === "invalid" ? ["left"] : ["left", "right"]);
    assert.deepEqual(await state.leftStore.readFile("/source"), bytes);
    assert.deepEqual(await state.rightStore.readFile("/target"), previous);
  });
}

test("terminal authorities are queried once each, including reverse-only proof", async () => {
  const state = await fixture();
  const calls: string[] = [];
  registerEntryAuthority(state.left, async () => { calls.push("left"); return "unknown"; });
  registerEntryAuthority(state.right, async () => { calls.push("right"); return "distinct"; });
  assert.equal(await compareEntries(state.left, "/source", state.right, "/target"), "distinct");
  assert.deepEqual(calls, ["left", "right"]);
});

for (const code of ["ENOENT", "EACCES", "EIO"] as const) {
  test(`real metadata/authority ${code} errors propagate without content effects`, async () => {
    const state = await fixture();
    const failure = new FsError(code);
    registerEntryAuthority(state.left, async () => { throw failure; });
    await assert.rejects(compareEntries(state.left, "/source", state.right, "/target"), error => error === failure);
    await assert.rejects(compareEntries(state.left, "/missing", state.right, "/target"), { code: "ENOENT" });
    assert.deepEqual(await state.leftStore.readFile("/source"), bytes);
  });
}

test("ENOENT-shaped cancellation stops between authorities and remains the exact reason", async () => {
  const state = await fixture();
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "cancel, not absent" });
  const calls: string[] = [];
  registerEntryAuthority(state.left, async (_own, _peer, options) => {
    assert.equal(options.signal, controller.signal);
    calls.push("left");
    controller.abort(reason);
    return "unknown";
  });
  registerEntryAuthority(state.right, async () => { calls.push("right"); return "distinct"; });
  await assert.rejects(compareEntries(state.left, "/source", state.right, "/target", { signal: controller.signal }), error => error === reason);
  assert.deepEqual(calls, ["left"]);
});

test("recursive negotiation stays unknown without requerying; cyclic trusted views fail EIO", async () => {
  const state = await fixture();
  let calls = 0;
  registerEntryAuthority(state.left, async (own, peer, options) => {
    calls++;
    return compareEntries(own.filesystem, own.path, peer.filesystem, peer.path, options);
  });
  assert.equal(await compareEntries(state.left, "/source", state.right, "/target"), "unknown");
  assert.equal(calls, 1);
  const cyclic = unscoped(state.leftStore);
  registerEntryView(cyclic, async path => ({ filesystem: cyclic, path }));
  await assert.rejects(resolveEntryView(cyclic, "/source"), { code: "EIO" });
});

test("opaque forwarding of a negotiating wrapper method stays unknown before nested metadata or authority queries", async () => {
  const state = await fixture();
  registerEntryAuthority(state.left, state.authority);
  registerEntryAuthority(state.right, state.authority);
  const events: string[] = [];
  const opaque = (filesystem: FileSystem, name: string): FileSystem => wrapped(filesystem, {
    realpath: async (path, options) => {
      events.push(`${name}.realpath`);
      return filesystem.realpath(path, options);
    },
    lstat: async (path, options) => {
      events.push(`${name}.lstat`);
      return filesystem.lstat(path, options);
    },
    compareEntry: async (path, peer, peerPath, options) => {
      events.push(`${name}.compareEntry`);
      return compareEntries(filesystem, path, peer, peerPath, options);
    },
  });
  const left = opaque(createReadOnlyFileSystem(state.left), "left");
  const right = opaque(state.right, "right");
  assert.equal(await compareEntries(left, "/source", right, "/target"), "unknown");
  assert.deepEqual(state.calls, []);
  assert.deepEqual(events, ["left.realpath", "left.lstat", "right.realpath", "right.lstat", "left.compareEntry", "right.compareEntry"]);
  assert.deepEqual(await state.leftStore.readFile("/source"), bytes);
  assert.deepEqual(await state.rightStore.readFile("/target"), previous);
});

test("overlay comparison observes selected backing without copy-up, then changes after a real copy-up", async () => {
  const state = await fixture();
  const upper = createMemoryFileSystem();
  registerEntryAuthority(state.left, state.authority);
  registerEntryAuthority(state.right, state.authority);
  const overlay = createOverlayFileSystem({ upper, lower: state.left });
  assert.equal(await overlay.compareEntry("/source", state.right, "/target"), "distinct");
  assert.deepEqual(await upper.readdir("/"), []);
  assert.equal((await resolveEntryView(overlay, "/source")).filesystem, state.left);
  await overlay.appendFile("/source", new Uint8Array([33]));
  assert.equal((await resolveEntryView(overlay, "/source")).filesystem, upper);
  assert.deepEqual(await state.leftStore.readFile("/source"), bytes);
});

test("synthetic mount directories compare as unknown without inventing backing entries", async () => {
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/virtual/deep": createMemoryFileSystem() } });
  assert.equal(await mount.compareEntry("/virtual", createMemoryFileSystem(), "/"), "unknown");
});
