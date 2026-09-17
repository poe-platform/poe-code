import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { PythonFileSystem } from "../src/python/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";

it("removes a Python directory tree without following a contained symlink", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/temporary/nested", { recursive: true });
  await fs.writeFile("/temporary/nested/file", new Uint8Array([1]));
  await fs.writeFile("/unrelated", new Uint8Array([2]));
  await fs.symlink("/unrelated", "/temporary/link");
  const service = new PythonFileSystem(fs, { cwd: "/" });
  try {
    await expect(service.dispatch({ op: "rmtree", args: ["/temporary"] })).resolves.toBeUndefined();
    await expect(fs.lstat("/temporary")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile("/unrelated")).toEqual(new Uint8Array([2]));
  } finally { await service.close(); }
});

it("refuses a replacement tree raced after Python selects its cleanup identity", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/temporary");
  await fs.writeFile("/temporary/owned", new Uint8Array([1]));
  const original = fs.lstat.bind(fs);
  let replaced = false;
  fs.lstat = async (path, options) => {
    const stat = await original(path, options);
    if (path === "/temporary" && !replaced) {
      replaced = true;
      await fs.rename("/temporary", "/retained");
      await fs.mkdir("/temporary");
      await fs.writeFile("/temporary/unrelated", new Uint8Array([2]));
    }
    return stat;
  };
  const service = new PythonFileSystem(fs, { cwd: "/" });
  try {
    await expect(service.dispatch({ op: "rmtree", args: ["/temporary"] })).rejects.toMatchObject({ code: "EAGAIN" });
    expect(await fs.readFile("/retained/owned")).toEqual(new Uint8Array([1]));
    expect(await fs.readFile("/temporary/unrelated")).toEqual(new Uint8Array([2]));
  } finally { await service.close(); }
});

it("preserves mounted, readonly, quota and scoped cleanup authority", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/temporary");
  await fs.writeFile("/temporary/file", new Uint8Array([1]));
  const mount = new DeviceFileSystem(new MountFileSystem({ root: fs }));
  const readonly = new PythonFileSystem(new ReadOnlyFileSystem(mount), { cwd: "/" });
  await expect(readonly.dispatch({ op: "rmtree", args: ["/temporary"] })).rejects.toMatchObject({ code: "EROFS" });
  await readonly.close();
  const controller = new AbortController();
  let charged = 0;
  const quota = withFileSystemQuota(mount, { maxBytes: 1 });
  const scoped = scopeFileSystem(quota, () => { charged++; }, controller.signal);
  const service = new PythonFileSystem(scoped, { cwd: "/" });
  try {
    await service.dispatch({ op: "rmtree", args: ["/temporary"] });
    expect(charged).toBeGreaterThanOrEqual(4);
    await quota.writeFile("/next", new Uint8Array([2]));
    await expect(quota.writeFile("/overflow", new Uint8Array([3]))).rejects.toMatchObject({ code: "ENOSPC" });
  } finally { await service.close(); }
});

it("refuses removal across a nested mount boundary", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/temporary/nested", { recursive: true });
  await fs.writeFile("/temporary/owned", new Uint8Array([1]));
  const remote = new MemoryFileSystem();
  await remote.writeFile("/unrelated", new Uint8Array([2]));
  const mount = new MountFileSystem({ root: fs, mounts: { "/temporary/nested": remote } });
  const service = new PythonFileSystem(mount, { cwd: "/" });
  try {
    await expect(service.dispatch({ op: "rmtree", args: ["/temporary"] })).rejects.toMatchObject({ code: "EBUSY" });
    expect(await remote.readFile("/unrelated")).toEqual(new Uint8Array([2]));
    expect(await fs.readFile("/temporary/owned")).toEqual(new Uint8Array([1]));
  } finally { await service.close(); }
});

it("does not substitute unchecked recursive rm when atomic cleanup is unavailable", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/temporary");
  Object.defineProperty(fs, "removeTreeConditional", { value: undefined });
  const service = new PythonFileSystem(fs, { cwd: "/" });
  try {
    await expect(service.dispatch({ op: "rmtree", args: ["/temporary"] })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(await fs.lstat("/temporary")).toMatchObject({ type: "directory" });
  } finally { await service.close(); }
});
