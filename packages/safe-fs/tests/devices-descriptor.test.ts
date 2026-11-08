import { expect, it, vi } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import type { OpenFileOptions } from "../src/contracts/descriptor.js";
import type { FileSystem, FileSystemCapabilities } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { dirname } from "../src/contracts/virtual-path.js";

function implicitFixture(aggregate = true, selected?: boolean) {
  const memory = new MemoryFileSystem();
  const capabilities: FileSystemCapabilities = { ...memory.capabilities, implicitDirectories: aggregate };
  const query = vi.fn(async () => ({ ...capabilities, implicitDirectories: selected ?? aggregate }));
  const open = vi.fn(async (path: string, options: OpenFileOptions) => {
    options.signal?.throwIfAborted();
    await memory.mkdir(dirname(path), { recursive: true, ...(options.signal ? { signal: options.signal } : {}) });
    return memory.open(path, options);
  });
  const fs: FileSystem = new Proxy(memory, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return query;
    if (key === "open") return open;
    if (key === "mkdir" || key === "copyFile") return () => { throw new Error("Device view must not create parents or copy files"); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { memory, query, open, fs, view: createDeviceFileSystem(fs) };
}

for (const aggregate of [false, true]) it(`defers implicit-parent creation to the selected backend: aggregate=${aggregate}`, async () => {
  const { memory, query, open, view } = implicitFixture(aggregate, true);
  const options = { create: true, signal: new AbortController().signal };
  expect((await view.capabilitiesFor("/missing/deep/file", options)).implicitDirectories).toBe(true);
  expect(query).toHaveBeenCalledExactlyOnceWith("/missing/deep/file", options);
  expect(open).not.toHaveBeenCalled();
  expect(await memory.readdir("/")).toEqual([]);
  const descriptor = await view.open("/missing/deep/file", { access: "write", creation: "ifMissing" });
  try { expect(await descriptor.write(Uint8Array.of(7), null)).toBe(1); }
  finally { await descriptor.close(); }
  expect(await memory.readFile("/missing/deep/file")).toEqual(Uint8Array.of(7));
});

it("retains missing-parent errors when selected capabilities do not advertise implicit directories", async () => {
  const { memory, open, view } = implicitFixture(true, false);
  await expect(view.capabilitiesFor("/missing/file", { create: true })).rejects.toMatchObject({ code: "ENOENT" });
  expect(open).not.toHaveBeenCalled();
  expect(await memory.readdir("/")).toEqual([]);
  await expect(createDeviceFileSystem(memory).capabilitiesFor("/missing/file", { create: true })).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not reinterpret noncreating queries or backend refusal as implicit creation", async () => {
  const { memory, query, open, view } = implicitFixture();
  await expect(view.capabilitiesFor("/missing/file", { create: false })).rejects.toMatchObject({ code: "ENOENT" });
  expect(query).not.toHaveBeenCalled();
  const refusal = new FsError("EACCES");
  query.mockRejectedValueOnce(refusal);
  await expect(view.capabilitiesFor("/missing/file", { create: true })).rejects.toBe(refusal);
  expect(open).not.toHaveBeenCalled();
  expect(await memory.readdir("/")).toEqual([]);
});

for (const code of ["ENOENT", "ENOTDIR", "EACCES"] as const) it(`leaves final creation authority with the backend: ${code}`, async () => {
  const { memory, open, view } = implicitFixture();
  expect((await view.capabilitiesFor("/missing/file", { create: true })).implicitDirectories).toBe(true);
  const refusal = new FsError(code);
  open.mockRejectedValueOnce(refusal);
  const options: OpenFileOptions = { access: "write", creation: "ifMissing", truncate: true };
  await expect(view.open("/missing/file", options)).rejects.toBe(refusal);
  expect(open).toHaveBeenCalledExactlyOnceWith("/missing/file", options);
  expect(await memory.readdir("/")).toEqual([]);
});

it("does not dispatch a fallback capability getter that cancels acquisition", async () => {
  const { memory, query, fs } = implicitFixture();
  const controller = new AbortController();
  const view = createDeviceFileSystem(new Proxy(fs, { get(target, key) {
    if (key === "capabilitiesFor") { controller.abort(false); return query; }
    return Reflect.get(target, key, target);
  } }));
  await expect(view.capabilitiesFor("/missing/file", { create: true, signal: controller.signal })).rejects.toBe(false);
  expect(query).not.toHaveBeenCalled();
  expect(await memory.readdir("/")).toEqual([]);
});

it("preserves ancestor and virtual-device traversal failures on implicit backends", async () => {
  const { memory, open, view } = implicitFixture();
  await memory.writeFile("/file", Uint8Array.of(9));
  await memory.mkdir("/blocked");
  await memory.chmod("/blocked", 0);
  for (const [path, code] of [["/file/child", "ENOTDIR"], ["/blocked/child", "EACCES"], ["/missing/../dev/null", "ENOENT"]]) {
    await expect(view.capabilitiesFor(path!, { create: true })).rejects.toMatchObject({ code });
  }
  expect(open).not.toHaveBeenCalled();
  expect(await memory.readFile("/file")).toEqual(Uint8Array.of(9));
  await expect(memory.stat("/missing")).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains exclusive creation errors and device isolation on implicit backends", async () => {
  const { memory, open, view } = implicitFixture();
  const descriptor = await view.open("/missing/file", { access: "write", creation: "exclusive" });
  await descriptor.close();
  await expect(view.open("/missing/file", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
  await memory.symlink("self", "/self");
  await expect(view.open("/self", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
  open.mockClear();
  expect((await view.capabilitiesFor("/dev/null", { create: true })).open).toBe(true);
  const sink = await view.open("/dev/null", { access: "write", creation: "ifMissing" });
  try { await sink.write(Uint8Array.of(4), null); } finally { await sink.close(); }
  expect(open).not.toHaveBeenCalled();
  await expect(memory.stat("/dev")).rejects.toMatchObject({ code: "ENOENT" });
});

for (const reason of [false, new FsError("ENOENT")]) it(`preserves cancellation during implicit capability admission: ${String(reason)}`, async () => {
  const { memory, query, open, view } = implicitFixture();
  await expect(view.capabilitiesFor("/missing/file", { create: true, signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  expect(query).not.toHaveBeenCalled();
  const controller = new AbortController();
  query.mockImplementationOnce(async () => { controller.abort(reason); return { ...memory.capabilities, implicitDirectories: true }; });
  await expect(view.capabilitiesFor("/missing/file", { create: true, signal: controller.signal })).rejects.toBe(reason);
  expect(open).not.toHaveBeenCalled();
  expect(await memory.readdir("/")).toEqual([]);
});

for (const access of ["read", "write", "readwrite"] as const) it(`opens null descriptors with ${access} access without retaining bytes`, async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/dev");
  await memory.writeFile("/dev/null", Uint8Array.of(42));
  const view = createDeviceFileSystem(memory);
  const descriptor = await view.open("/dev/null", { access });
  try {
    expect(await descriptor.stat()).toMatchObject({ type: "character", mode: 0o020666, size: 0 });
    expect(await descriptor.stat()).toEqual(await view.stat("/dev/null"));
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
    const bytes = Uint8Array.of(7, 8, 9);
    for (const position of [null, 0, 100]) {
      if (access !== "write") {
        expect(await descriptor.read(bytes, position)).toBe(0);
        expect(bytes).toEqual(Uint8Array.of(7, 8, 9));
      } else await expect(descriptor.read(bytes, position)).rejects.toMatchObject({ code: "EBADF" });
      if (access !== "read") expect(await descriptor.write(bytes, position)).toBe(3);
      else await expect(descriptor.write(bytes, position)).rejects.toMatchObject({ code: "EBADF" });
    }
    expect(await descriptor.getPosition!()).toBe(0);
    expect((await descriptor.stat()).size).toBe(0);
  } finally { await descriptor.close(); }
  await descriptor.close();
  await expect(descriptor.stat()).rejects.toMatchObject({ code: "EBADF" });
  expect(await memory.readFile("/dev/null")).toEqual(Uint8Array.of(42));
});

it("admits ordinary creation and truncating opens without advertising descriptor resizing", async () => {
  const view = createDeviceFileSystem(new MemoryFileSystem());
  expect((await view.capabilitiesFor("/dev/null")).open).toBe(true);
  expect((await view.capabilitiesFor("/dev")).open).toBe(false);
  await expect(view.open("/dev/null", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
  await expect(view.open("/dev", { access: "read" })).rejects.toMatchObject({ code: "ENOTSUP" });
  for (const creation of ["never", "ifMissing"] as const) {
    const descriptor = await view.open("/dev/null", { access: "readwrite", creation, truncate: true, append: true });
    try {
      expect(descriptor.capabilities).toMatchObject({ openTruncate: true, truncate: false, synchronization: "none", positionedAppendWrite: true });
      expect(await descriptor.write(new Uint8Array(), 0)).toBe(0);
      expect(await descriptor.write(Uint8Array.of(1), 500)).toBe(1);
      await expect(descriptor.truncate(0)).rejects.toMatchObject({ code: "ENOTSUP" });
      await expect(descriptor.sync(false)).rejects.toMatchObject({ code: "ENOTSUP" });
    } finally { await descriptor.close(); }
  }
});

it("retains descriptor admission, position validation and cancellation semantics", async () => {
  const view = createDeviceFileSystem(new MemoryFileSystem());
  for (const options of [{ access: "invalid" }, { access: "read", truncate: true }, { access: "write", extra: true }]) {
    await expect(view.open("/dev/null", options as OpenFileOptions)).rejects.toMatchObject({ code: "EINVAL" });
  }
  await expect(view.open("/dev/null", { access: "write", synchronization: "all" })).rejects.toMatchObject({ code: "ENOTSUP" });
  const descriptor = await view.open("/dev/null", { access: "readwrite" });
  try {
    for (const position of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(descriptor.read(new Uint8Array(1), position)).rejects.toMatchObject({ code: "EINVAL" });
      await expect(descriptor.write(new Uint8Array(1), position)).rejects.toMatchObject({ code: "EINVAL" });
    }
    for (const reason of [false, null]) {
      const signal = AbortSignal.abort(reason);
      await expect(view.open("/dev/null", { access: "read", signal })).rejects.toBe(reason);
      await expect(descriptor.read(new Uint8Array(1), null, { signal })).rejects.toBe(reason);
      await expect(descriptor.write(new Uint8Array(1), null, { signal })).rejects.toBe(reason);
      const controller = new AbortController();
      const opening = view.open("/dev/null", { access: "read", signal: controller.signal });
      controller.abort(reason);
      await expect(opening).rejects.toBe(reason);
    }
  } finally { await descriptor.close(); }
});

it("resolves null aliases and preserves read-only wrapper ordering", async () => {
  const memory = new MemoryFileSystem();
  await memory.symlink("/dev/null", "/alias");
  const view = createDeviceFileSystem(new ReadOnlyFileSystem(memory));
  for (const path of ["/dev/null", "/dev/./null", "/alias"]) {
    const descriptor = await view.open(path, { access: "write", truncate: true });
    try { expect(await descriptor.write(Uint8Array.of(1), null)).toBe(1); }
    finally { await descriptor.close(); }
  }
  await expect(view.open("/dev/null/", { access: "read" })).rejects.toMatchObject({ code: "ENOTDIR" });
  const readonly = new ReadOnlyFileSystem(view);
  await expect(readonly.open!("/dev/null", { access: "write" })).rejects.toMatchObject({ code: "EROFS" });
});

it.each([0, 1])("yields across repeated %i-byte null writes so timer cancellation can run", async length => {
  const descriptor = await createDeviceFileSystem(new MemoryFileSystem()).open("/dev/null", { access: "write" });
  const controller = new AbortController();
  const reason = new Error("cancel repeated null writes");
  const writing = (async () => {
    for (let index = 0; index < 256; index++) await descriptor.write(new Uint8Array(length), null, { signal: controller.signal });
    throw new Error("null writes starved timer cancellation");
  })();
  const rejected = expect(writing).rejects.toBe(reason);
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await rejected; }
  finally { clearTimeout(timer); await descriptor.close(); }
});
