import { describe, expect, it, vi } from "vitest";
import type { FileReadHandle, FileSystem } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function view(backing: FileSystem, overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(Object.create(backing) as FileSystem, {
    get(_target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value = Reflect.get(backing, property);
      return typeof value === "function" ? value.bind(backing) : value;
    },
  });
}

const wrappers: readonly [string, (backing: FileSystem) => FileSystem][] = [
  ["readonly", (backing) => new ReadOnlyFileSystem(backing)],
  ["quota", (backing) => withFileSystemQuota(backing, { maxBytes: 64, maxScanEntries: 0 })],
  ["mount", (backing) => new MountFileSystem({ root: backing })],
  ["overlay", (backing) => new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: backing })],
];

describe.each(wrappers)("%s retained-read composition", (_name, wrap) => {
  it("returns the original handle and preserves its resource, identity, bytes and close", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("one"));
    const original = await memory.openReadFile("/file");
    const open = vi.fn(async () => original);
    const filesystem = wrap(view(memory, { openReadFile: open }));
    expect(filesystem.capabilities.retainedRead).toBe(true);
    expect((await filesystem.capabilitiesFor?.("/file"))?.retainedRead).toBe(true);
    const handle = await filesystem.openReadFile!("/file");
    expect(handle).toBe(original);
    expect(open).toHaveBeenCalledTimes(1);
    const identity = await handle.stat();
    expect(identity.identityScope).toBe((await memory.stat("/file")).identityScope);
    await memory.rename("/file", "/moved");
    await memory.appendFile("/moved", encode("two"));
    await memory.writeFile("/file", encode("new"));
    expect(decode(await handle.read(3, 3))).toBe("two");
    await memory.rm("/moved");
    expect(decode(await handle.read(0, 6))).toBe("onetwo");
    expect(await handle.stat()).toMatchObject({ identityScope: identity.identityScope, ino: identity.ino, size: 6 });
    const bytes = await handle.read(0, 3);
    bytes.fill(0);
    expect(decode(await handle.read(0, 3))).toBe("one");
    const close = handle.close();
    expect(handle.close()).toBe(close);
    await close;
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it.each([false, undefined])("refuses capability %s before opening or reading", async (retainedRead) => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const open = vi.fn(async () => memory.openReadFile("/file"));
    const read = vi.fn(async () => encode("wrong"));
    const { retainedRead: ignoredRetainedRead, ...capabilities } = memory.capabilities;
    const filesystem = wrap(view(memory, {
      capabilities: { ...capabilities, ...(retainedRead === undefined ? {} : { retainedRead }) }, openReadFile: open, readFile: read,
    }));
    expect(filesystem.capabilities.retainedRead).not.toBe(true);
    expect((await filesystem.capabilitiesFor?.("/file"))?.retainedRead).not.toBe(true);
    await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(open).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not advertise a flag whose acquisition method is missing", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const filesystem = wrap(view(memory, { openReadFile: undefined }));
    expect(filesystem.capabilities.retainedRead).not.toBe(true);
    expect((await filesystem.capabilitiesFor?.("/file"))?.retainedRead).toBe(false);
    await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
  });

  it("uses selected-path admission instead of a global summary", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("yes"));
    await memory.writeFile("/blocked", encode("no"));
    const open = vi.fn(memory.openReadFile.bind(memory));
    const filesystem = wrap(view(memory, {
      capabilities: { ...memory.capabilities, retainedRead: false },
      capabilitiesFor: async (path) => ({ ...memory.capabilities, retainedRead: path === "/file" }),
      openReadFile: open,
    }));
    expect((await filesystem.capabilitiesFor?.("/file"))?.retainedRead).toBe(true);
    expect((await filesystem.capabilitiesFor?.("/blocked"))?.retainedRead).toBe(false);
    const handle = await filesystem.openReadFile!("/file");
    expect(decode(await handle.read(0, 3))).toBe("yes");
    await handle.close();
    await expect(filesystem.openReadFile!("/blocked")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not replace unknown path support with a positive global capability", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const { retainedRead: ignoredRetainedRead, ...capabilities } = memory.capabilities;
    const open = vi.fn(memory.openReadFile.bind(memory));
    const filesystem = wrap(view(memory, { capabilitiesFor: async () => capabilities, openReadFile: open }));
    expect(filesystem.capabilities.retainedRead).toBe(true);
    const selected = await filesystem.capabilitiesFor!("/file");
    expect(Object.hasOwn(selected, "retainedRead")).toBe(false);
    await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(open).not.toHaveBeenCalled();
  });

  it.each([false, null, 0, "", Number.NaN])("pre-abort (%s) performs zero backend calls", async (reason) => {
    const memory = new MemoryFileSystem();
    let calls = 0;
    const backing = new Proxy(memory, {
      get(target, property) {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? (...args: unknown[]) => { calls++; return value.apply(target, args); } : value;
      },
    });
    const filesystem = wrap(backing);
    expect(filesystem.openReadFile).toBeTypeOf("function");
    const controller = new AbortController();
    controller.abort(reason);
    await expect(filesystem.openReadFile!("/file", { signal: controller.signal })).rejects.toBe(reason);
    expect(calls).toBe(0);
  });

  it.each([false, null])("drains a late acquisition and preserves abort %j over failed close", async (reason) => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const acquired = deferred<void>();
    const arrival = deferred<void>();
    const closing = deferred<void>();
    const release = deferred<void>();
    const close = vi.fn(async () => { closing.resolve(); await release.promise; throw "cleanup"; });
    const handle: FileReadHandle = { stat: vi.fn(), read: vi.fn(), close };
    const filesystem = wrap(view(memory, {
      openReadFile: async () => { acquired.resolve(); await arrival.promise; return handle; },
    }));
    expect(filesystem.openReadFile).toBeTypeOf("function");
    const controller = new AbortController();
    let settled = false;
    const outcome = filesystem.openReadFile!("/file", { signal: controller.signal }).then(
      (value) => { settled = true; return { value }; },
      (error: unknown) => { settled = true; return { error }; },
    );
    await acquired.promise;
    controller.abort(reason);
    arrival.resolve();
    await Promise.race([closing.promise, outcome]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    release.resolve();
    expect(await outcome).toEqual({ error: reason });
    expect(close).toHaveBeenCalledTimes(1);
    expect(handle.read).not.toHaveBeenCalled();
  });

  it("observes cancellation during capability admission without opening", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const controller = new AbortController();
    const open = vi.fn(memory.openReadFile.bind(memory));
    const filesystem = wrap(view(memory, {
      capabilitiesFor: async () => { controller.abort(false); return memory.capabilities; },
      openReadFile: open,
    }));
    expect(filesystem.openReadFile).toBeTypeOf("function");
    await expect(filesystem.openReadFile!("/file", { signal: controller.signal })).rejects.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([false, null, undefined, 0, "", Number.NaN])("preserves falsey acquisition failure (%s)", async (reason) => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const filesystem = wrap(view(memory, { openReadFile: async () => { throw reason; } }));
    await expect(filesystem.openReadFile!("/file")).rejects.toBe(reason);
  });

  it("does not weaken stock modified-adapter admission", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const read = vi.fn(memory.readFile.bind(memory));
    Object.defineProperty(memory, "readFile", { value: read });
    const filesystem = wrap(memory);
    await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a reader live at EOF and observes truncation without reopening", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("start"));
    const open = vi.fn(memory.openReadFile.bind(memory));
    const capability = vi.fn(async () => memory.capabilities);
    const filesystem = wrap(view(memory, { openReadFile: open, capabilitiesFor: capability }));
    const handle = await filesystem.openReadFile!("/file");
    const admissions = capability.mock.calls.length;
    expect(await handle.read(5, 2)).toHaveLength(0);
    await memory.appendFile("/file", encode("!"));
    expect(decode(await handle.read(5, 2))).toBe("!");
    await memory.truncate("/file", 1);
    expect((await handle.stat()).size).toBe(1);
    expect(await handle.read(5, 2)).toHaveLength(0);
    expect(decode(await handle.read(0, 2))).toBe("s");
    expect(open).toHaveBeenCalledTimes(1);
    expect(capability).toHaveBeenCalledTimes(admissions);
    await handle.close();
  });

  it("returns the admitted backend's close barrier without weakening drain or rejections", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const completion = deferred<Uint8Array>();
    const closed = deferred<void>();
    let accepting = true;
    const rejected = new Error("closed");
    const original: FileReadHandle = {
      stat: memory.stat.bind(memory, "/file"),
      read: () => accepting ? completion.promise : Promise.reject(rejected),
      close: () => { accepting = false; return closed.promise; },
    };
    const filesystem = wrap(view(memory, { openReadFile: async () => original }));
    const handle = await filesystem.openReadFile!("/file");
    const reading = handle.read(0, 4);
    const closing = handle.close();
    expect(handle).toBe(original);
    expect(handle.close()).toBe(closing);
    expect(closing).toBe(closed.promise);
    await expect(handle.read(0, 4)).rejects.toBe(rejected);
    completion.resolve(encode("data"));
    expect(decode(await reading)).toBe("data");
    closed.resolve();
    await closing;
  });

  it("forwards unknown opened identity without inventing wrapper authority", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const original = await memory.openReadFile("/file");
    const unknown: FileReadHandle = {
      read: original.read, close: original.close,
      stat: async (options) => {
        const { identityScope: ignoredScope, dev: ignoredDev, ino: ignoredIno, ...stat } = await original.stat(options);
        return stat;
      },
    };
    const filesystem = wrap(view(memory, { openReadFile: async () => unknown }));
    const handle = await filesystem.openReadFile!("/file");
    expect(handle).toBe(unknown);
    expect((await handle.stat()).identityScope).toBeUndefined();
    expect((await handle.stat()).ino).toBeUndefined();
    await handle.close();
  });

  it("refuses actual mock S3 and WebDAV without content reads", async () => {
    const transport = new MockS3Client({ buckets: ["bucket"] });
    const s3 = new S3FileSystem({ bucket: "bucket", transport });
    const dav = new MockDav();
    const webdav = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: dav.createFetch() });
    const backends: FileSystem[] = [s3, webdav];
    for (const backing of backends) {
      await backing.writeFile("/file", encode("data"));
      const read = vi.spyOn(backing, "readFile");
      const stream = vi.spyOn(backing, "readStream");
      const filesystem = wrap(backing);
      expect(backing.openReadFile).toBeUndefined();
      expect(backing.capabilities.retainedRead).toBeUndefined();
      expect(filesystem.capabilities.retainedRead).not.toBe(true);
      await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(read).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    }
    expect(dav.requests.some((request) => request.init.method === "GET")).toBe(false);
  });
});

describe("retained routing and wrapper masks", () => {
  it("pins mount aliases to genuine storage, not equal inode numbers in other mounts", async () => {
    const first = new MemoryFileSystem();
    const second = new MemoryFileSystem();
    await first.writeFile("/file", encode("first"));
    await second.writeFile("/file", encode("other"));
    const filesystem = new MountFileSystem({ root: first, mounts: { "/alias": first, "/other": second } });
    const handles = await Promise.all(["/file", "/alias/file", "/other/file"].map((path) => filesystem.openReadFile!(path)));
    const original = await handles[0]!.stat();
    const alias = await handles[1]!.stat();
    const other = await handles[2]!.stat();
    expect(alias.identityScope).toBe(original.identityScope);
    expect(alias.ino).toBe(original.ino);
    expect(other.ino).toBe(original.ino);
    expect(other.identityScope).not.toBe(original.identityScope);
    await first.rename("/file", "/renamed");
    await first.writeFile("/file", encode("newer"));
    expect(decode(await handles[1]!.read(0, 5))).toBe("first");
    await Promise.all(handles.map((handle) => handle.close()));
  });

  it("preserves mount symlink confinement and pins an admitted within-mount target", async () => {
    const root = new MemoryFileSystem();
    const mounted = new MemoryFileSystem();
    await mounted.writeFile("/file", encode("first"));
    await mounted.writeFile("/next", encode("later"));
    await root.symlink("/other/file", "/link");
    await mounted.symlink("/file", "/link");
    const filesystem = new MountFileSystem({ root, mounts: { "/other": mounted } });
    await expect(filesystem.openReadFile("/link")).rejects.toMatchObject({ code: "EACCES", path: "/link" });
    const handle = await filesystem.openReadFile("/other/link");
    await mounted.rm("/link");
    await mounted.symlink("/next", "/link");
    expect(decode(await handle.read(0, 5))).toBe("first");
    expect((await handle.stat()).identityScope).toBe((await mounted.stat("/file")).identityScope);
    await handle.close();
  });

  it("does not reroute an overlay acquisition when a new upper entry appears", async () => {
    const lower = new MemoryFileSystem();
    const upper = new MemoryFileSystem();
    await lower.writeFile("/file", encode("lower"));
    const selected = deferred<void>();
    const acquire = deferred<void>();
    const open = vi.fn(async (path: string) => {
      selected.resolve();
      await acquire.promise;
      return lower.openReadFile(path);
    });
    const filesystem = new OverlayFileSystem({ upper, lower: view(lower, { openReadFile: open }) });
    const opening = filesystem.openReadFile("/file");
    await selected.promise;
    await upper.writeFile("/file", encode("upper"));
    acquire.resolve();
    const handle = await opening;
    expect(decode(await handle.read(0, 5))).toBe("lower");
    const next = await filesystem.openReadFile("/file");
    expect(decode(await next.read(0, 5))).toBe("upper");
    expect(open).toHaveBeenCalledTimes(1);
    await handle.close();
    await next.close();
  });

  it("admits mixed mounts by selected path and reports virtual acquisition errors", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const denied = view(memory, { capabilities: { ...memory.capabilities, retainedRead: false } });
    const filesystem = new MountFileSystem({ root: denied, mounts: { "/yes": memory } });
    expect(filesystem.capabilities.retainedRead).toBeUndefined();
    expect((await filesystem.capabilitiesFor("/yes/file")).retainedRead).toBe(true);
    const handle = await filesystem.openReadFile!("/yes/file");
    await handle.close();
    await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP", path: "/file" });
    await expect(filesystem.openReadFile!("/yes/missing")).rejects.toMatchObject({ code: "ENOENT", path: "/yes/missing" });
    await expect(filesystem.openReadFile!("/yes")).rejects.toMatchObject({ code: "EISDIR", path: "/yes" });
  });

  it("keeps a lower reader pinned across copy-up while new readers select upper", async () => {
    const lower = new MemoryFileSystem();
    const upper = new MemoryFileSystem();
    await lower.writeFile("/file", encode("lower"));
    const filesystem = new OverlayFileSystem({ upper, lower });
    const before = await filesystem.openReadFile!("/file");
    await expect(upper.stat("/file")).rejects.toMatchObject({ code: "ENOENT" });
    await filesystem.appendFile("/file", encode("+"));
    const after = await filesystem.openReadFile!("/file");
    expect(decode(await before.read(0, 6))).toBe("lower");
    expect(decode(await after.read(0, 6))).toBe("lower+");
    expect((await before.stat()).identityScope).toBe((await lower.stat("/file")).identityScope);
    expect((await after.stat()).identityScope).toBe((await upper.stat("/file")).identityScope);
    expect((await before.stat()).identityScope).not.toBe((await after.stat()).identityScope);
    await before.close();
    await after.close();
  });

  it("does not fall back to a capable lower layer hidden by an unsupported upper", async () => {
    const lower = new MemoryFileSystem();
    const upper = new MemoryFileSystem();
    await lower.writeFile("/file", encode("lower"));
    await upper.writeFile("/file", encode("upper"));
    const filesystem = new OverlayFileSystem({ lower, upper: view(upper, {
      capabilities: { ...upper.capabilities, retainedRead: false },
    }) });
    expect(filesystem.capabilities.retainedRead).toBeUndefined();
    expect((await filesystem.capabilitiesFor!("/file")).retainedRead).toBe(false);
    await expect(filesystem.openReadFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect((await filesystem.capabilitiesFor!("/new")).write).toBe(filesystem.capabilities.write);
    await expect(filesystem.openReadFile!("/new")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves nested readonly/quota canonicalization masks and read-only admission", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", encode("data"));
    const quota = withFileSystemQuota(memory, { maxBytes: 4, maxScanEntries: 0 });
    const readonly: FileSystem = new ReadOnlyFileSystem(quota);
    const filesystem = new MountFileSystem({ root: readonly });
    expect(quota.canonicalizeMissingTarget).toBeUndefined();
    expect(readonly.canonicalizeMissingTarget).toBeUndefined();
    const handle = await filesystem.openReadFile!("/file");
    expect(decode(await handle.read(0, 4))).toBe("data");
    await expect(filesystem.writeFile("/file", encode("bad"))).rejects.toMatchObject({ code: "EROFS" });
    await expect(quota.appendFile("/file", encode("!"))).rejects.toMatchObject({ code: "EFBIG" });
    await handle.close();
  });
});
