import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createMountFileSystem, type ConditionalRemoveEntryOptions, type FileSystem, type FsOptions } from "../../src/index.js";
import { createDeviceFileSystem, scopeFileSystem } from "@poe-code/safe-fs/core";
import { MoveBudget, moveAcrossDevices } from "../../src/commands/move.js";
import { run } from "./helpers.js";

test("legacy conditional removal remains Promise<void> through public filesystem types", async () => {
  const memory = createMemoryFileSystem();
  for (const fs of [memory, createMountFileSystem({ root: memory }), createDeviceFileSystem(memory), scopeFileSystem(memory, () => {}, new AbortController().signal)] as const) {
    await fs.writeFile("/entry", Uint8Array.of(1));
    const options: ConditionalRemoveEntryOptions = { parent: await fs.lstat("/"), expected: await fs.lstat("/entry") };
    const done: Promise<void> = fs.removeEntryConditional!("/entry", options);
    assert.equal(await done, undefined);
  }
});

test("source removal receipts remain valid when the wall clock moves backwards", async context => {
  context.mock.method(Date, "now", () => 1000);
  const source = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await source.mkdir("/tree");
  await source.writeFile("/tree/a", Buffer.from("payload"));
  await source.link("/tree/a", "/tree/b");
  const backend = new Proxy(source, { get(target, property) {
    if (property === "removeEntryConditional") return async (...args: Parameters<typeof source.removeEntryConditional>) => {
      context.mock.method(Date, "now", () => 500);
      return source.removeEntryConditional(...args);
    };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": backend, "/destination": destination } });
  const result = await run("mv", ["/source/tree", "/destination/tree"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(source.lstat("/tree"), { code: "ENOENT" });
  assert.equal(Buffer.from(await destination.readFile("/tree/a")).toString(), "payload");
  assert.equal(Buffer.from(await destination.readFile("/tree/b")).toString(), "payload");
});

for (const nested of [false, true]) for (const external of [false, true]) for (const count of [2, 3]) {
  test(`cross-device directory mv removes shared source links, nested=${nested}, external=${external}, count=${count}`, async () => {
    const source = createMemoryFileSystem(), destination = createMemoryFileSystem();
    await source.mkdir("/tree/left", { recursive: true });
    await source.mkdir("/tree/right", { recursive: true });
    const first = nested ? "/tree/left/a" : "/tree/a", second = nested ? "/tree/right/b" : "/tree/b";
    await source.writeFile(first, Buffer.from("payload"));
    await source.link(first, second);
    const third = nested ? "/tree/right/c" : "/tree/c";
    if (count === 3) await source.link(first, third);
    if (external) await source.link(first, "/held");
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": source, "/destination": destination } });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec("mv /source/tree /destination/tree");
      assert.equal(result.exitCode, 0, result.stderr);
      await assert.rejects(source.lstat("/tree"), { code: "ENOENT" });
      assert.equal(Buffer.from(await destination.readFile(first)).toString(), "payload");
      assert.equal(Buffer.from(await destination.readFile(second)).toString(), "payload");
      if (count === 3) assert.equal(Buffer.from(await destination.readFile(third)).toString(), "payload");
      if (external) {
        assert.equal(Buffer.from(await source.readFile("/held")).toString(), "payload");
        assert.equal((await source.lstat("/held")).nlink, 1);
      }
    } finally { await shell.dispose(); }
  });
}

for (const change of ["contents", "link", "unlink", "path", "parent", "missing-receipt", "wrong-receipt", "time-receipt", "owner-receipt", "cancel"] as const) {
  test(`cross-device directory mv preserves remaining source after ${change} between sibling unlinks`, async context => {
    if (change === "contents") context.mock.method(Date, "now", () => 1234);
    const source = createMemoryFileSystem(), destination = createMemoryFileSystem();
    await source.mkdir("/tree/left", { recursive: true });
    await source.mkdir("/tree/right", { recursive: true });
    await source.writeFile("/tree/left/a", Buffer.from("payload"));
    await source.link("/tree/left/a", "/tree/right/b");
    await source.link("/tree/left/a", "/outside");
    const before = await source.lstat("/tree/left/a");
    const caller = new AbortController(), reason = new Error("stop after committed unlink");
    let intercepted = 0;
    const backend = new Proxy(source, { get(target, property) {
      if (property === "removeEntryConditional") return async (...args: Parameters<typeof source.removeEntryConditional>) => {
        const receipt = await source.removeEntryConditional(...args);
        if (args[0] !== "/tree/right/b") return receipt;
        intercepted++;
        if (change === "contents") {
          await source.writeFile("/tree/left/a", Buffer.from("changed"));
          await source.utimes("/tree/left/a", before.atimeMs, before.mtimeMs);
        } else if (change === "link") await source.link("/tree/left/a", "/extra");
        else if (change === "unlink") await source.rm("/outside");
        else if (change === "path") {
          await source.rename("/tree/left/a", "/held");
          await source.writeFile("/tree/left/a", Buffer.from("changed"));
        } else if (change === "parent") {
          await source.rename("/tree/left", "/held");
          await source.mkdir("/tree/left");
          await source.writeFile("/tree/left/a", Buffer.from("changed"));
        } else if (change === "missing-receipt") return undefined;
        else if (change === "wrong-receipt") return { ...before, nlink: before.nlink };
        else if (change === "time-receipt" || change === "owner-receipt") {
          assert.ok(receipt);
          return { ...receipt, ...(change === "time-receipt" ? { ctimeMs: NaN } : { uid: 1 }) };
        }
        else caller.abort(reason);
        return receipt;
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": backend, "/destination": destination } });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const execution = shell.exec("mv /source/tree /destination/tree", { signal: caller.signal });
      if (change === "cancel") await assert.rejects(execution, error => error === reason);
      else {
        const result = await execution;
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, change.endsWith("receipt") ? /EIO/u : /EAGAIN|EBUSY/u);
      }
      assert.equal(intercepted, 1);
      assert.equal(Buffer.from(await source.readFile("/tree/left/a")).toString(), ["contents", "path", "parent"].includes(change) ? "changed" : "payload");
      assert.equal(Buffer.from(await destination.readFile("/tree/left/a")).toString(), "payload");
      assert.equal(Buffer.from(await destination.readFile("/tree/right/b")).toString(), "payload");
      if (change === "path" || change === "parent") assert.equal(Buffer.from(await source.readFile(change === "path" ? "/held" : "/held/a")).toString(), "payload");
    } finally { await shell.dispose(); }
  });
}

for (const supported of [false, undefined]) test(`directory mv admits unlink receipts before copying, supported=${supported}`, async () => {
  const source = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await source.mkdir("/tree");
  await source.writeFile("/tree/a", Buffer.from("payload"));
  await source.link("/tree/a", "/tree/b");
  const backend = new Proxy(source, { get(target, property) {
    if (property === "capabilities") return { ...source.capabilities, atomicEntryRemovalReceipt: supported };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": backend, "/destination": destination } });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const refused = await shell.exec("mv /source/tree /destination/tree");
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /ENOTSUP.*'\/source\/tree\/a'/u);
    assert.deepEqual(await destination.readdir("/"), []);
    assert.deepEqual((await source.readdir("/tree")).map(entry => entry.name), ["a", "b"]);
    const ordinary = await shell.exec("mv /source/tree/a /destination/a");
    assert.equal(ordinary.exitCode, 0, ordinary.stderr);
    assert.equal(Buffer.from(await source.readFile("/tree/b")).toString(), "payload");
    assert.equal(Buffer.from(await destination.readFile("/a")).toString(), "payload");
  } finally { await shell.dispose(); }
});

for (const direct of [false, true]) for (const method of ["rm", "removeEntryConditional"] as const) test(`cross-device mv never deletes through a swapped source parent at ${method}, direct=${direct}`, async () => {
  const root = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await root.mkdir("/work/sub", { recursive: true });
  await root.mkdir("/private");
  await root.writeFile("/work/sub/a", Buffer.from("ordinary"));
  await root.writeFile("/private/a", Buffer.from("topsecret"));
  const base = createMountFileSystem({ root, mounts: { "/dest": destination } });
  let intercepted = false;
  const fs = new Proxy(base, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === method) return async (path: string, options: FsOptions) => {
      if (path !== "/work/sub/a") return value.call(target, path, options);
      intercepted = true;
      await root.rename("/work/sub", "/work/held");
      await root.symlink("/private", "/work/sub");
      try { return await value.call(target, path, options); }
      finally { await root.rm("/work/sub"); await root.rename("/work/held", "/work/sub"); }
    };
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = direct
      ? await run("move-direct", [], { fs, commands: [{ name: "move-direct", description: "Exercise cross-device move", async execute(context) {
        try { await moveAcrossDevices(context, "/work/sub/a", "/dest/a", false, new MoveBudget(context.signal)); return { exitCode: 0 }; }
        catch { return { exitCode: 1 }; }
      } }] })
      : await shell.exec("mv sub/a /dest/a");
    assert.equal(Buffer.from(await root.readFile("/private/a")).toString(), "topsecret");
    assert.equal(Buffer.from(await destination.readFile("/a")).toString(), "ordinary");
    assert.equal(intercepted, method === "removeEntryConditional");
    if (intercepted) {
      assert.equal(result.exitCode, 1);
      assert.equal(Buffer.from(await root.readFile("/work/sub/a")).toString(), "ordinary");
    } else assert.equal(result.exitCode, 0, result.stderr);
  } finally { await shell.dispose(); }
});

for (const supported of [false, undefined]) test(`cross-device mv refuses before copying when atomic removal is ${supported}`, async () => {
  const root = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await root.writeFile("/source", Buffer.from("original"));
  const base = createMountFileSystem({ root, mounts: { "/dest": destination } });
  let copies = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "capabilitiesFor") return async () => ({ ...root.capabilities, atomicEntryRemoval: supported });
    if (key === "writeStream") return async () => { copies++; };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const result = await run("mv", ["/source", "/dest/a"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  assert.equal(copies, 0);
  assert.equal(Buffer.from(await root.readFile("/source")).toString(), "original");
  assert.deepEqual(await destination.readdir("/"), []);
});

test("cross-device directory move requires authoritative planned identity before copying", async () => {
  const root = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await root.mkdir("/source");
  await root.writeFile("/source/a", Buffer.from("original"));
  const base = createMountFileSystem({ root, mounts: { "/dest": destination } });
  let copies = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "lstat") return async (path: string, options: FsOptions) => {
      const stat = await base.lstat(path, options);
      if (path !== "/source") return stat;
      const { identityScope: omitted, ...unknown } = stat;
      void omitted;
      return unknown;
    };
    if (key === "writeStream") return async (...args: Parameters<NonNullable<FileSystem["writeStream"]>>) => { copies++; await base.writeStream!(...args); };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const result = await run("mv", ["/source", "/dest/source"], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(copies, 0);
  assert.deepEqual(await destination.readdir("/"), []);
});
