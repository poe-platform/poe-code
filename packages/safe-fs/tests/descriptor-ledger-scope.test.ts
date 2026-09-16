import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { bridgeStats } from "../src/bridge/stats.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";

it("reports absent backing canonical open as unavailable even without a global declaration", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", Uint8Array.of(65));
  const capabilities = { ...backing.capabilities };
  delete capabilities.open;
  Object.defineProperty(backing, "capabilities", { value: capabilities });
  Object.defineProperty(backing, "open", { value: undefined });
  const fs = new DeviceFileSystem(backing);
  expect((await fs.capabilitiesFor("/file")).open).toBe(false);
  const reader = await fs.openReadFile("/file");
  expect(await reader.read(0, 1)).toEqual(Uint8Array.of(65));
  await reader.close();
});

it("rejects descriptor acquisition before creating a file when retained admission is exhausted", async () => {
  const fs = new MemoryFileSystem({ maxMetadataUnits: 3 });
  await expect(fs.open("/file", { access: "write", creation: "ifMissing" })).rejects.toMatchObject({ code: "ENOSPC" });
  expect(await fs.readdir("/")).toEqual([]);
});

it("retains an unlinked inode until both descriptor protocols close", async () => {
  const fs = new MemoryFileSystem({ maxBytes: 4 });
  await fs.writeFile("/file", new Uint8Array(4));
  const descriptor = await fs.open("/file", { access: "readwrite" });
  const reader = await fs.openReadFile("/file");
  await fs.rm("/file");
  await descriptor.close();
  await expect(fs.writeFile("/next", new Uint8Array(1))).rejects.toMatchObject({ code: "ENOSPC" });
  expect(await reader.read(0, 4)).toEqual(new Uint8Array(4));
  await reader.close();
  await fs.writeFile("/next", new Uint8Array(4));
});

it("scopes canonical descriptor acquisition and operations while leaving close available", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(4));
  const controller = new AbortController();
  let charges = 0;
  const scoped = scopeFileSystem(fs, () => { charges++; }, controller.signal);
  const descriptor = await scoped.open!("/file", { access: "readwrite" });
  expect(charges).toBe(1);
  await descriptor.stat();
  expect(charges).toBe(2);
  controller.abort(false);
  await expect(descriptor.write(new Uint8Array([1]), 0)).rejects.toBe(false);
  await expect(scoped.open!("/file", { access: "read" })).rejects.toBe(false);
  await descriptor.close();
  expect(await fs.readFile("/file")).toEqual(new Uint8Array(4));
});

it("cleans up a descriptor acquired after its scope was cancelled", async () => {
  const fs = new MemoryFileSystem({ maxMetadataUnits: 4 });
  await fs.writeFile("/file", new Uint8Array(4));
  const controller = new AbortController();
  const open = fs.open.bind(fs);
  fs.open = async (path, options) => {
    const descriptor = await open(path, options);
    controller.abort(false);
    return descriptor;
  };
  const scoped = scopeFileSystem(fs, () => {}, controller.signal);
  await expect(scoped.open!("/file", { access: "read" })).rejects.toBe(false);
  const next = await open("/file", { access: "read" });
  await next.close();
});

it("does not dispatch a descriptor operation after its metering callback cancels the scope", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(4));
  const controller = new AbortController();
  let cancel = false;
  const scoped = scopeFileSystem(fs, () => { if (cancel) controller.abort(false); }, controller.signal);
  const descriptor = await scoped.open!("/file", { access: "write" });
  cancel = true;
  await expect(descriptor.write(new Uint8Array([1]), 0)).rejects.toBe(false);
  await descriptor.close();
  expect(await fs.readFile("/file")).toEqual(new Uint8Array(4));
});

it("bridges either block-size contract with explicit legacy precedence", async () => {
  const fs = new MemoryFileSystem();
  const { ioBlockSize: ignoredLegacy, preferredIoBlockSize: ignoredPreferred, ...stat } = await fs.stat("/");
  expect(bridgeStats({ ...stat, ioBlockSize: 32768, preferredIoBlockSize: 8192 }).blksize).toBe(32768);
  expect(bridgeStats({ ...stat, preferredIoBlockSize: 8192 }).blksize).toBe(8192);
  expect(bridgeStats(stat).blksize).toBe(4096);
});

it("preserves backing canonical descriptors while keeping synthetic devices retained-only", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", new Uint8Array([1, 2, 3]));
  const devices = new DeviceFileSystem(memory);
  expect(devices.capabilities.open).toBeUndefined();
  expect((await devices.capabilitiesFor("/file")).open).toBe(true);
  expect((await devices.capabilitiesFor("/dev/null")).open).toBe(false);
  const descriptor = await devices.open("/file", { access: "readwrite" });
  const original = await descriptor.stat();
  await memory.rm("/file");
  await memory.writeFile("/file", new Uint8Array([4]));
  await descriptor.write(new Uint8Array([9]), 1);
  const bytes = new Uint8Array(3);
  expect(await descriptor.read(bytes, 0)).toBe(3);
  expect(bytes).toEqual(new Uint8Array([1, 9, 3]));
  expect((await descriptor.stat()).ino).toBe(original.ino);
  await descriptor.close();
  expect(await memory.readFile("/file")).toEqual(new Uint8Array([4]));
  await memory.symlink("/dev/null", "/null-alias");
  for (const path of ["/dev/null", "/dev", "/null-alias"]) {
    await expect(devices.open(path, { access: "read" })).rejects.toMatchObject({ code: "ENOTSUP" });
  }
});

it("closes a canonical descriptor acquired after device-view cancellation", async () => {
  const memory = new MemoryFileSystem({ maxMetadataUnits: 4 });
  await memory.writeFile("/file", new Uint8Array());
  const open = memory.open.bind(memory);
  const controller = new AbortController();
  memory.open = async (path, options) => {
    const descriptor = await open(path, options);
    controller.abort(false);
    return descriptor;
  };
  const devices = new DeviceFileSystem(memory);
  await expect(devices.open("/file", { access: "read", signal: controller.signal })).rejects.toBe(false);
  const descriptor = await open("/file", { access: "read" });
  await descriptor.close();
});

it("keeps device-view cancellation primary over a backing acquisition failure", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", new Uint8Array());
  const controller = new AbortController();
  memory.open = async () => { controller.abort(false); throw new Error("late acquisition failure"); };
  const devices = new DeviceFileSystem(memory);
  await expect(devices.open("/file", { access: "read", signal: controller.signal })).rejects.toBe(false);
});
