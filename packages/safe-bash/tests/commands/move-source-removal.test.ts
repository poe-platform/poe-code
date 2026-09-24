import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createMountFileSystem, type FileSystem, type FsOptions } from "../../src/index.js";
import { MoveBudget, moveAcrossDevices } from "../../src/commands/move.js";
import { run } from "./helpers.js";

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
    if (key === "copyFile") return async () => { copies++; };
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
    if (key === "copyFile") return async (...args: Parameters<FileSystem["copyFile"]>) => { copies++; await base.copyFile(...args); };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const result = await run("mv", ["/source", "/dest/source"], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(copies, 0);
  assert.deepEqual(await destination.readdir("/"), []);
});
