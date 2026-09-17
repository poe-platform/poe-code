import { expect, it, vi } from "vitest";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { PythonFileSystem } from "../src/python/index.js";

it("Python unlink cannot remove a raced replacement directory", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/directory");
  const service = new PythonFileSystem(fs, { cwd: "/" });
  await expect(service.dispatch({ op: "rm", args: ["/directory"] })).rejects.toMatchObject({ code: "EISDIR" });
  expect(await fs.stat("/directory")).toMatchObject({ type: "directory" });
  expect(typeof fs.unlink).toBe("function");
  await expect(fs.unlink("/directory")).rejects.toMatchObject({ code: "EISDIR" });
  await service.close();
});

it("ignores injected recursive options for unlink and preserves symlink targets", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/directory");
  await fs.writeFile("/directory/file", new Uint8Array([1]));
  await expect(fs.unlink("/directory", { recursive: true } as never)).rejects.toMatchObject({ code: "EISDIR" });
  await fs.symlink("/directory", "/link");
  await fs.unlink("/link");
  expect(await fs.readFile("/directory/file")).toEqual(new Uint8Array([1]));
});


it("mount unlink preserves backend authority while readonly and quota cannot bypass policy", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array([1]));
  const mount = new MountFileSystem({ root: fs });
  await expect(new ReadOnlyFileSystem(mount).unlink("/file")).rejects.toMatchObject({ code: "EROFS" });
  const quota = withFileSystemQuota(mount, { maxBytes: 1 });
  expect(typeof quota.unlink).toBe("function");
  await expect(withFileSystemQuota(new ReadOnlyFileSystem(mount), { maxBytes: 1 }).unlink!("/file")).rejects.toMatchObject({ code: "EROFS" });
  const controller = new AbortController();
  controller.abort(false);
  await expect(quota.unlink!("/file", { signal: controller.signal })).rejects.toBe(false);
  const retained = await mount.open("/file", { access: "read" });
  await quota.unlink!("/file");
  expect(await retained.stat()).toMatchObject({ size: 1, nlink: 0 });
  await retained.close();
});


it("scoped unlink charges operation admission and preserves cancellation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  const charge = vi.fn();
  const controller = new AbortController();
  const scoped = scopeFileSystem(fs, charge, controller.signal);
  await scoped.unlink!("/file");
  expect(charge).toHaveBeenCalledTimes(1);
  await fs.writeFile("/file", new Uint8Array());
  controller.abort(false);
  await expect(scoped.unlink!("/file")).rejects.toBe(false);
  expect(await fs.stat("/file")).toMatchObject({ type: "file" });
});


it("default device view forwards canonical unlink and protects reserved devices", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array([1]));
  await fs.symlink("/dev/null", "/alias");
  const devices = new DeviceFileSystem(fs);
  const service = new PythonFileSystem(devices, { cwd: "/" });
  await service.dispatch({ op: "rm", args: ["/file"] });
  await service.dispatch({ op: "rm", args: ["/alias"] });
  await expect(fs.stat("/file")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(service.dispatch({ op: "rm", args: ["/dev/null"] })).rejects.toMatchObject({ code: "EBUSY" });
  await expect(service.dispatch({ op: "rm", args: ["/dev"] })).rejects.toMatchObject({ code: "EBUSY" });
  expect(await devices.stat("/dev/null")).toMatchObject({ type: "character" });
  await service.close();
});
