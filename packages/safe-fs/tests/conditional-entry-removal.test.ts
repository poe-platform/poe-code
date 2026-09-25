import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

for (const view of ["memory", "scope", "mount", "devices"] as const) {
  async function fixture() {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/work");
    const fs: FileSystem = view === "scope" ? scopeFileSystem(memory, () => {}, new AbortController().signal)
      : view === "mount" ? new MountFileSystem({ root: memory })
      : view === "devices" ? new DeviceFileSystem(memory) : memory;
    return { memory, fs, parent: await fs.lstat("/work") };
  }
  for (const type of ["file", "symlink", "directory"] as const) {
    test(`${view} conditionally removes exact ${type} without following final links`, async () => {
      const { fs, parent } = await fixture();
      await fs.writeFile("/target", Uint8Array.of(9));
      if (type === "file") await fs.writeFile("/work/entry", Uint8Array.of(1));
      else if (type === "directory") await fs.mkdir("/work/entry");
      else await fs.symlink!("/target", "/work/entry");
      const expected = await fs.lstat("/work/entry");
      assert.equal((await fs.capabilitiesFor?.("/work/entry") ?? fs.capabilities).atomicEntryRemoval, true);
      await fs.removeEntryConditional!("/work/entry", { parent, expected });
      await assert.rejects(fs.lstat("/work/entry"), { code: "ENOENT" });
      assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(9));
    });
    test(`${view} refuses replaced ${type} and parent`, async () => {
      const { fs, parent } = await fixture();
      if (type === "file") await fs.writeFile("/work/entry", Uint8Array.of(1));
      else if (type === "directory") await fs.mkdir("/work/entry");
      else await fs.symlink!("/target", "/work/entry");
      const expected = await fs.lstat("/work/entry");
      await fs.rename("/work/entry", "/work/held");
      await fs.writeFile("/work/entry", Uint8Array.of(9));
      await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "EAGAIN" });
      await fs.rename("/work", "/held");
      await fs.mkdir("/work");
      await fs.writeFile("/work/entry", Uint8Array.of(7));
      await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "EAGAIN" });
      assert.deepEqual(await fs.readFile("/work/entry"), Uint8Array.of(7));
    });
  }
  test(`${view} returns the inode snapshot produced by its own unlink`, async () => {
    const { fs, parent } = await fixture();
    await fs.writeFile("/work/entry", Uint8Array.of(4));
    await fs.link!("/work/entry", "/work/peer");
    const expected = await fs.lstat("/work/entry");
    const options = { parent, expected, returnRemainingStat: true };
    const receipt = await fs.removeEntryConditional!("/work/entry", options);
    assert.ok(receipt);
    assert.ok(Object.isFrozen(receipt));
    assert.equal(receipt.nlink, 1);
    assert.equal(receipt.ino, expected.ino);
    assert.equal(receipt.identityScope, expected.identityScope);
    assert.ok(receipt.revision! > expected.revision!);
    assert.deepEqual(receipt, await fs.lstat("/work/peer"));
    const final = await fs.removeEntryConditional!("/work/peer", { ...options, expected: receipt });
    assert.ok(final);
    assert.equal(final.nlink, 0);
    assert.equal(final.size, 1);
    await assert.rejects(fs.lstat("/work/peer"), { code: "ENOENT" });
  });
  test(`${view} removal receipt does not accept a later same-tick same-size write`, async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const { fs, parent } = await fixture();
      await fs.writeFile("/work/entry", Uint8Array.of(4));
      await fs.link!("/work/entry", "/work/peer");
      const options = { parent, expected: await fs.lstat("/work/entry"), returnRemainingStat: true };
      const receipt = await fs.removeEntryConditional!("/work/entry", options);
      assert.ok(receipt);
      await fs.writeFile("/work/peer", Uint8Array.of(9));
      await assert.rejects(fs.removeEntryConditional!("/work/peer", { parent, expected: receipt }), { code: "EAGAIN" });
      assert.deepEqual(await fs.readFile("/work/peer"), Uint8Array.of(9));
    } finally { clock.mockRestore(); }
  });
  test(`${view} refuses nonempty directories without recursively deleting children`, async () => {
    const { fs, parent } = await fixture();
    await fs.mkdir("/work/entry");
    await fs.writeFile("/work/entry/child", Uint8Array.of(3));
    const expected = await fs.lstat("/work/entry");
    await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "ENOTEMPTY" });
    assert.deepEqual(await fs.readFile("/work/entry/child"), Uint8Array.of(3));
  });
  test(`${view} refuses stale revisions and precommit cancellation`, async () => {
    const { fs, parent } = await fixture();
    await fs.writeFile("/work/entry", Uint8Array.of(1));
    const expected = await fs.lstat("/work/entry");
    await fs.writeFile("/work/entry", Uint8Array.of(2));
    await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "EAGAIN" });
    const controller = new AbortController(); controller.abort(false);
    await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected: await fs.lstat("/work/entry"), signal: controller.signal }), error => error === false);
    assert.deepEqual(await fs.readFile("/work/entry"), Uint8Array.of(2));
  });
}

test("conditional entry removal refuses unknown identity and revisions", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/entry", Uint8Array.of(1));
  const parent = await fs.lstat("/");
  const expected = await fs.lstat("/entry");
  for (const field of ["revision", "identityScope", "ino", "dev"] as const) {
    const unknown = { ...expected }; delete unknown[field];
    await assert.rejects(fs.removeEntryConditional("/entry", { parent, expected: unknown }), { code: "ENOTSUP" });
  }
  assert.deepEqual(await fs.readFile("/entry"), Uint8Array.of(1));
});

test("scoped removal respects operation budget and revoked lifetime", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  const parent = await memory.lstat("/");
  const expected = await memory.lstat("/entry");
  const budget = new Error("budget exhausted");
  const limited = scopeFileSystem(memory, () => { throw budget; }, new AbortController().signal);
  await assert.rejects(limited.removeEntryConditional!("/entry", { parent, expected }), error => error === budget);
  const controller = new AbortController();
  const scoped = scopeFileSystem(memory, () => {}, controller.signal);
  controller.abort(false);
  await assert.rejects(scoped.removeEntryConditional!("/entry", { parent, expected }), error => error === false);
  assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
});

test("views refuse entry removal when backend does not advertise the capability", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  const parent = await memory.lstat("/");
  const expected = await memory.lstat("/entry");
  let calls = 0;
  const backend = new Proxy(memory, { get(target, property) {
    if (property === "capabilities") return { ...memory.capabilities, atomicEntryRemoval: false };
    if (property === "removeEntryConditional") return async () => { calls++; };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const fs of [scopeFileSystem(backend, () => {}, new AbortController().signal), new MountFileSystem({ root: backend }), new DeviceFileSystem(backend)]) {
    await assert.rejects(fs.removeEntryConditional!("/entry", { parent, expected }), { code: "ENOTSUP" });
  }
  assert.equal(calls, 0);
});

test("entry removal preserves another hardlink and does not remove root or terminal-dot entries", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/entry", Uint8Array.of(4));
  await fs.link!("/work/entry", "/work/alias");
  await fs.removeEntryConditional("/work/entry", { parent: await fs.lstat("/work"), expected: await fs.lstat("/work/entry") });
  assert.deepEqual(await fs.readFile("/work/alias"), Uint8Array.of(4));
  assert.equal((await fs.lstat("/work/alias")).nlink, 1);
  await assert.rejects(fs.removeEntryConditional("/work/.", { parent: await fs.lstat("/"), expected: await fs.lstat("/work") }), { code: "EINVAL" });
  await assert.rejects(fs.removeEntryConditional("/", { parent: await fs.lstat("/"), expected: await fs.lstat("/") }), { code: "EBUSY" });
});

test("read-only and quota views cannot expose entry removal as a mutation bypass", async () => {
  const { ReadOnlyFileSystem } = await import("../src/fs/readonly/index.js");
  const { withFileSystemQuota } = await import("../src/fs/quota/index.js");
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  for (const fs of [new ReadOnlyFileSystem(memory), withFileSystemQuota(memory, { maxBytes: 100 })]) {
    assert.equal(fs.capabilities.atomicEntryRemoval, false);
    assert.equal(fs.capabilities.atomicEntryRemovalReceipt, false);
    assert.equal(fs.removeEntryConditional, undefined);
  }
  assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
});

for (const view of ["scope", "mount", "devices"] as const) {
  const wrap = (fs: FileSystem, signal: AbortSignal) => view === "scope" ? scopeFileSystem(fs, () => {}, signal)
    : view === "mount" ? new MountFileSystem({ root: fs }) : new DeviceFileSystem(fs);
  test(`${view} preserves a committed removal receipt after cancellation`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/entry", Uint8Array.of(1));
    await memory.link("/entry", "/peer");
    const controller = new AbortController();
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "removeEntryConditional") return async (...args: Parameters<typeof memory.removeEntryConditional>) => {
        const receipt = await memory.removeEntryConditional(...args);
        controller.abort(false);
        return receipt;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const fs = wrap(backend, controller.signal);
    const options = { parent: await fs.lstat("/"), expected: await fs.lstat("/entry"), returnRemainingStat: true, signal: controller.signal };
    const receipt = await fs.removeEntryConditional!("/entry", options);
    assert.ok(receipt);
    assert.equal(receipt.nlink, 1);
    assert.equal(controller.signal.aborted, true);
    await assert.rejects(memory.lstat("/entry"), { code: "ENOENT" });
    assert.deepEqual(await memory.readFile("/peer"), Uint8Array.of(1));
  });
  test(`${view} refuses a requested removal receipt before calling an unsupported backend`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/entry", Uint8Array.of(1));
    let calls = 0;
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "capabilities") return { ...memory.capabilities, atomicEntryRemovalReceipt: false };
      if (property === "removeEntryConditional") return async (...args: Parameters<typeof memory.removeEntryConditional>) => {
        calls++;
        return memory.removeEntryConditional(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const fs = wrap(backend, new AbortController().signal);
    const options = { parent: await fs.lstat("/"), expected: await fs.lstat("/entry"), returnRemainingStat: true };
    await assert.rejects(fs.removeEntryConditional!("/entry", options), { code: "ENOTSUP" });
    assert.equal(calls, 0);
    assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
  });
  test(`${view} stops receipt removal when cancellation arrives during capability admission`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/entry", Uint8Array.of(1));
    const controller = new AbortController();
    let calls = 0;
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "capabilitiesFor") return async () => {
        controller.abort(false);
        return memory.capabilities;
      };
      if (property === "removeEntryConditional") return async (...args: Parameters<typeof memory.removeEntryConditional>) => {
        calls++;
        return memory.removeEntryConditional(...args);
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const options = { parent: await memory.lstat("/"), expected: await memory.lstat("/entry"), returnRemainingStat: true, signal: controller.signal };
    await assert.rejects(wrap(backend, controller.signal).removeEntryConditional!("/entry", options), reason => reason === false);
    assert.equal(calls, 0);
    assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
  });
  for (const requested of [false, true]) test(`${view} normalizes backend removal results, requested=${requested}`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/entry", Uint8Array.of(1));
    let backendReceipt: { nlink?: number } | undefined;
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "removeEntryConditional") return async (...args: Parameters<typeof memory.removeEntryConditional>) => {
        const result = await memory.removeEntryConditional(args[0], { ...args[1], returnRemainingStat: true });
        assert.ok(result);
        const mutable = { ...result };
        backendReceipt = mutable;
        return mutable;
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = wrap(backend, new AbortController().signal);
    const result = await fs.removeEntryConditional!("/entry", {
      parent: await memory.lstat("/"), expected: await memory.lstat("/entry"), returnRemainingStat: requested,
    });
    if (requested) {
      assert.ok(result);
      assert.ok(Object.isFrozen(result));
      backendReceipt!.nlink = 99;
      assert.equal(result.nlink, 0);
    } else assert.equal(result, undefined);
  });
}

test("S3 namespace refuses receipt requests before mutation and retains ordinary removal", async () => {
  const { MockS3Client } = await import("../src/fs/s3/mock.js");
  const { createS3NamespaceFileSystem } = await import("../src/fs/s3/namespace.js");
  const client = new MockS3Client({ buckets: ["owned"] });
  const fs = await createS3NamespaceFileSystem({ client, bucket: "owned", key: "namespace.json" });
  assert.equal(fs.capabilities.atomicEntryRemovalReceipt, false);
  await fs.writeFile("/entry", Uint8Array.of(1));
  const options = { parent: await fs.lstat("/"), expected: await fs.lstat("/entry"), returnRemainingStat: true };
  const writes = client.requests.filter(request => request.operation === "putObject").length;
  await assert.rejects(fs.removeEntryConditional!("/entry", options), { code: "ENOTSUP" });
  assert.equal(client.requests.filter(request => request.operation === "putObject").length, writes);
  assert.deepEqual(await fs.readFile("/entry"), Uint8Array.of(1));
  assert.equal(await fs.removeEntryConditional!("/entry", { parent: options.parent, expected: options.expected }), undefined);
  await assert.rejects(fs.lstat("/entry"), { code: "ENOENT" });
});

test("scope captures the receipt request before charging the operation", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  const options = { parent: await memory.lstat("/"), expected: await memory.lstat("/entry"), returnRemainingStat: true };
  const fs = scopeFileSystem(memory, () => { options.returnRemainingStat = false; }, new AbortController().signal);
  const receipt = await fs.removeEntryConditional!("/entry", options);
  assert.ok(receipt);
  assert.equal(receipt.nlink, 0);
});

test("legacy conditional removal observes scope cancellation inside an awaited backend", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  const controller = new AbortController();
  const backend = new Proxy(memory, { get(target, property) {
    if (property === "removeEntryConditional") return async (...args: Parameters<typeof memory.removeEntryConditional>) => {
      await Promise.resolve();
      controller.abort(false);
      return memory.removeEntryConditional(...args);
    };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const fs = scopeFileSystem(backend, () => {}, controller.signal);
  await assert.rejects(fs.removeEntryConditional!("/entry", {
    parent: await memory.lstat("/"), expected: await memory.lstat("/entry"),
  }), reason => reason === false);
  assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
});

test("removal receipt capability requires atomic entry removal and its method", async () => {
  const memory = new MemoryFileSystem();
  for (const missing of ["capability", "method"] as const) {
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "capabilities") return { ...memory.capabilities, atomicEntryRemoval: missing === "capability" ? false : true, atomicEntryRemovalReceipt: true };
      if (property === "removeEntryConditional" && missing === "method") return undefined;
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    for (const fs of [scopeFileSystem(backend, () => {}, new AbortController().signal), new MountFileSystem({ root: backend }), new DeviceFileSystem(backend)]) {
      assert.notEqual(fs.capabilities.atomicEntryRemovalReceipt, true);
      assert.equal((await fs.capabilitiesFor?.("/") ?? fs.capabilities).atomicEntryRemovalReceipt, false);
    }
  }
});

test("overlay explicitly withholds atomic removal receipt support", async () => {
  const { OverlayFileSystem } = await import("../src/fs/overlay/index.js");
  const fs = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: new MemoryFileSystem() });
  assert.equal(fs.capabilities.atomicEntryRemoval, false);
  assert.equal(fs.capabilities.atomicEntryRemovalReceipt, false);
});
