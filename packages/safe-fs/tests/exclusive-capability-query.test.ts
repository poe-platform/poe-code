import { expect, it, vi } from "vitest";
import type { CapabilityQueryOptions, FileSystem, FileSystemCapabilities } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";

function profile(fs: FileSystem, capabilities: FileSystemCapabilities): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, ...capabilities };
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

const views = [
  { name: "device", wrap: (fs: FileSystem) => createDeviceFileSystem(fs) },
  { name: "mount", wrap: (fs: FileSystem) => createMountFileSystem({ root: fs }) },
  { name: "device/mount", wrap: (fs: FileSystem) => createDeviceFileSystem(createMountFileSystem({ root: fs })) },
  { name: "overlay", wrap: (fs: FileSystem) => createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: fs }) },
];

for (const view of views) {
  it(`exclusive queries preserve final symlink entry and parent traversal: ${view.name}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.symlink("loop", "/loop");
    const fs = view.wrap(backing);
    const options: CapabilityQueryOptions = { creation: "exclusive" };
    const write = vi.spyOn(backing, "writeFile");
    await expect(fs.capabilitiesFor!("/loop", options)).resolves.toMatchObject({ exclusiveCreate: true });
    expect(write).not.toHaveBeenCalled();
    expect(await backing.readlink("/loop")).toBe("loop");
    const following: CapabilityQueryOptions[] = [{}, { creation: "ifMissing" }, { creation: "never" }, { create: true }, { create: false }, { create: true, creation: "exclusive" }, { create: false, creation: "exclusive" }];
    for (const options of following) {
      await expect(fs.capabilitiesFor!("/loop", options)).rejects.toMatchObject({ code: "ELOOP" });
    }
    await expect(fs.capabilitiesFor!("/loop/file", { creation: "exclusive" })).rejects.toMatchObject({ code: "ELOOP" });
    await expect(fs.capabilitiesFor!("/loop/", options)).rejects.toMatchObject({ code: "ELOOP" });
    await expect(fs.capabilitiesFor!("/new", options)).resolves.toMatchObject({ exclusiveCreate: true });
    await expect(backing.lstat("/new")).rejects.toMatchObject({ code: "ENOENT" });
  });
}

it("exclusive queries retain selected mixed mount profiles without following the final link", async () => {
  const root = createMemoryFileSystem();
  const selected = createMemoryFileSystem();
  await selected.symlink("loop", "/loop");
  const backing = profile(selected, { open: false, exclusiveCreate: false, permissions: false });
  const mounted = createMountFileSystem({ root, mounts: { "/selected": backing } });
  const fs = createDeviceFileSystem(mounted);
  expect(mounted.capabilities.open).toBeUndefined();
  await expect(fs.capabilitiesFor("/selected/loop", { creation: "exclusive" })).resolves.toMatchObject({ open: false, exclusiveCreate: false, permissions: false });
  await expect(fs.capabilitiesFor("/root-new", { creation: "exclusive" })).resolves.toMatchObject({ open: true, exclusiveCreate: true, permissions: true });
});

it("exclusive queries preserve readonly mount policy and alias confinement", async () => {
  const root = createMemoryFileSystem();
  const selected = createMemoryFileSystem();
  await selected.symlink("loop", "/loop");
  await selected.symlink("../other", "/escape");
  const readonly = createReadOnlyFileSystem(selected);
  const fs = createDeviceFileSystem(createMountFileSystem({ root, mounts: { "/selected": readonly, "/other": createMemoryFileSystem() } }));
  await expect(fs.capabilitiesFor("/selected/loop", { creation: "exclusive" })).resolves.toMatchObject({ readOnly: true, exclusiveCreate: false });
  await expect(fs.open("/selected/loop", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EROFS" });
  await expect(fs.capabilitiesFor("/selected/escape/file", { creation: "exclusive" })).rejects.toMatchObject({ code: "EACCES" });
});

it("nested mounted exclusive open carries selected query intent before acquisition", async () => {
  const backing = createMemoryFileSystem();
  await backing.symlink("loop", "/loop");
  const query = vi.fn(async (path: string, options: CapabilityQueryOptions) => {
    if (options.creation !== "exclusive") await backing.stat(path);
    return backing.capabilities;
  });
  const leaf = new Proxy(backing, { get(target, key) {
    if (key === "capabilitiesFor") return query;
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const fs = createMountFileSystem({ root: createDeviceFileSystem(createMountFileSystem({ root: leaf })) });
  await expect(fs.open("/loop", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
  expect(query).toHaveBeenCalledTimes(2);
  for (const call of query.mock.calls) expect(call).toEqual(["/loop", expect.objectContaining({ creation: "exclusive" })]);
});

for (const selectedOpen of [false, true]) {
  it(`direct Mount exclusive acquisition obeys selected open policy over global ${!selectedOpen}: ${selectedOpen}`, async () => {
    const backing = createMemoryFileSystem();
    const open = vi.spyOn(backing, "open");
    const query = vi.fn(async (_path: string, _options: CapabilityQueryOptions) => ({ ...backing.capabilities, open: selectedOpen }));
    const leaf = new Proxy(backing, { get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, open: !selectedOpen };
      if (key === "capabilitiesFor") return query;
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = createMountFileSystem({ root: leaf });
    if (selectedOpen) {
      const descriptor = await fs.open("/new", { access: "write", creation: "exclusive" });
      await descriptor.close();
      expect(open).toHaveBeenCalledTimes(1);
      expect(await backing.readFile("/new")).toEqual(new Uint8Array());
    } else {
      await expect(fs.open("/new", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(open).not.toHaveBeenCalled();
      await expect(backing.lstat("/new")).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(query).toHaveBeenCalledExactlyOnceWith("/new", expect.objectContaining({ creation: "exclusive" }));
  });
}

it("direct Mount exclusive acquisition preserves a legacy provider query refusal", async () => {
  const backing = createMemoryFileSystem();
  await backing.symlink("loop", "/loop");
  const open = vi.spyOn(backing, "open");
  const query = vi.fn(async (path: string) => { await backing.stat(path); return backing.capabilities; });
  const leaf = new Proxy(backing, { get(target, key) {
    if (key === "capabilitiesFor") return query;
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await expect(createMountFileSystem({ root: leaf }).open("/loop", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "ELOOP" });
  expect(query).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  expect(await backing.readlink("/loop")).toBe("loop");
});

for (const reason of [null, false, 0, "", Number.NaN]) {
  it(`exclusive query cancellation preserves exact reason before/after provider lookup: ${String(reason)}`, async () => {
    const backing = createMemoryFileSystem();
    const controller = new AbortController();
    const query = vi.fn(async () => { controller.abort(reason); return backing.capabilities; });
    const leaf = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return query;
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = scopeFileSystem(createDeviceFileSystem(createMountFileSystem({ root: leaf })), () => {}, controller.signal);
    try { await fs.capabilitiesFor!("/new", { creation: "exclusive", signal: controller.signal }); expect.fail("expected cancellation"); }
    catch (error) { expect(Object.is(error, reason)).toBe(true); }
    expect(query).toHaveBeenCalledTimes(1);
    try { await fs.capabilitiesFor!("/new", { creation: "exclusive", signal: controller.signal }); expect.fail("expected pre-abort"); }
    catch (error) { expect(Object.is(error, reason)).toBe(true); }
    expect(query).toHaveBeenCalledTimes(1);
    expect(await backing.readdir("/")).toEqual([]);
  });
}

it("exclusive selected capability queries propagate provider refusal without acquisition", async () => {
  const backing = createMemoryFileSystem();
  const refusal = new FsError("EACCES", { path: "/new" });
  const open = vi.spyOn(backing, "open");
  const leaf = new Proxy(backing, { get(target, key) {
    if (key === "capabilitiesFor") return async () => { throw refusal; };
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const fs = createDeviceFileSystem(createMountFileSystem({ root: leaf }));
  await expect(fs.capabilitiesFor("/new", { creation: "exclusive" })).rejects.toMatchObject({ code: "EACCES", path: "/new", syscall: "capabilitiesFor" });
  expect(open).not.toHaveBeenCalled();
  expect(await backing.readdir("/")).toEqual([]);
});

it("exclusive legacy device loop delegation preserves prefix refusal and errno-shaped cancellation", async () => {
  const backing = createMemoryFileSystem();
  await backing.symlink("loop", "/loop");
  const fs = createDeviceFileSystem(backing);
  for (const flag of ["wx", "ax"] as const) await expect(fs.writeFile("/loop/child", Uint8Array.of(1), { flag })).rejects.toMatchObject({ code: "ELOOP" });
  const reason = new FsError("ELOOP");
  const controller = new AbortController();
  const write = vi.spyOn(backing, "writeFile");
  const leaf = new Proxy(backing, { get(target, key) {
    if (key === "lstat") return async () => { controller.abort(reason); throw reason; };
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await expect(createDeviceFileSystem(leaf).writeFile("/loop", Uint8Array.of(1), { flag: "wx", signal: controller.signal })).rejects.toBe(reason);
  expect(write).not.toHaveBeenCalled();
});
