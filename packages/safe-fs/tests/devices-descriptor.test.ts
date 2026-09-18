import { expect, it } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import type { OpenFileOptions } from "../src/contracts/descriptor.js";

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
