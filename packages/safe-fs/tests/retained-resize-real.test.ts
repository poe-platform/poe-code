import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { constants, type Stats } from "node:fs";
import * as native from "node:fs/promises";
import { RealFileSystem } from "../src/fs/real/index.js";
import type { FileResizeHandle, FileSystem, OpenResizeFileOptions } from "../src/contracts/filesystem.js";

const hooks = vi.hoisted(() => ({
  afterOpen: undefined as (() => Promise<void> | void) | undefined,
  beforeStat: undefined as (() => Promise<void> | void) | undefined,
  beforeTruncate: undefined as (() => Promise<void> | void) | undefined,
  beforeClose: undefined as (() => Promise<void> | void) | undefined,
  mapStat: undefined as ((value: Stats) => Stats) | undefined,
  blockSize: 4096 as unknown,
  deniedSearch: [] as string[],
  failOpen: false, failStat: false, failTruncate: false, failClose: false,
  reason: undefined as unknown, closeReason: undefined as unknown,
  stats: 0, truncates: [] as number[], closes: 0,
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const metadata = (value: Stats): Stats => {
    Object.defineProperty(value, "blksize", { value: hooks.blockSize, configurable: true });
    return value;
  };
  return {
    ...fs.promises,
    realpath: vi.fn(fs.promises.realpath.bind(fs.promises)),
    lstat: vi.fn(async (filename: string) => {
      if (hooks.deniedSearch.some(directory => filename.startsWith(`${directory}/`))) {
        throw Object.assign(new Error("directory search denied"), { code: "EACCES" });
      }
      return metadata(await fs.promises.lstat(filename) as Stats);
    }),
    readlink: vi.fn(fs.promises.readlink.bind(fs.promises)),
    stat: vi.fn(async (filename: string) => metadata(await fs.promises.stat(filename) as Stats)),
    open: vi.fn(async (filename: string, flags: number, mode?: number) => {
      if (hooks.failOpen) throw hooks.reason;
      const handle = await fs.promises.open(filename, flags, mode);
      const stat = handle.stat.bind(handle);
      const truncate = handle.truncate.bind(handle);
      const close = handle.close.bind(handle);
      handle.stat = async () => {
        hooks.stats++;
        await hooks.beforeStat?.();
        if (hooks.failStat) throw hooks.reason;
        const value = metadata(await stat() as Stats);
        return hooks.mapStat?.(value) ?? value;
      };
      handle.truncate = async length => {
        hooks.truncates.push(length ?? 0);
        await hooks.beforeTruncate?.();
        if (hooks.failTruncate) throw hooks.reason;
        return truncate(length);
      };
      handle.close = async () => {
        hooks.closes++;
        await hooks.beforeClose?.();
        await close();
        if (hooks.failClose) throw hooks.closeReason;
      };
      await hooks.afterOpen?.();
      return handle;
    }),
  };
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture(): RealFileSystem {
  return new RealFileSystem("/machine");
}

async function open(filesystem: FileSystem = fixture(), path = "/file", options?: OpenResizeFileOptions): Promise<FileResizeHandle> {
  expect(filesystem.openResizeFile, "optional retained-resize API").toBeTypeOf("function");
  return filesystem.openResizeFile!(path, options);
}

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "abc", "/outside/secret": "secret" });
  Object.assign(hooks, {
    afterOpen: undefined, beforeStat: undefined, beforeTruncate: undefined, beforeClose: undefined,
    mapStat: undefined, blockSize: 4096, deniedSearch: [],
    failOpen: false, failStat: false, failTruncate: false, failClose: false,
    reason: undefined, closeReason: new Error("secondary close failure"),
    stats: 0, truncates: [], closes: 0,
  });
  vi.clearAllMocks();
});

afterEach(() => { vi.restoreAllMocks(); });

describe("Real retained resizing", () => {
  it("acquires write-only without append or truncation and exposes only the resize handle", async () => {
    const filesystem = fixture();
    const before = await filesystem.stat("/file");
    const handle = await open(filesystem);
    try {
      expect(filesystem.capabilities.retainedResize).toBe(true);
      expect(Object.keys(handle).sort()).toEqual(["close", "seekEnd", "stat", "truncate"]);
      expect(native.open).toHaveBeenCalledWith("/machine/file", constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o666);
      expect(await handle.stat()).toEqual(before);
      expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
      expect(hooks.truncates).toEqual([]);
    } finally { await handle.close(); }
  });

  it.each([undefined, false])("does not create unless requested: %s", async create => {
    await expect(open(fixture(), "/missing", create === undefined ? {} : { create })).rejects.toMatchObject({ code: "ENOENT", path: "/missing" });
    expect(vol.existsSync("/machine/missing")).toBe(false);
    expect(native.open).not.toHaveBeenCalled();
  });

  it("creates with the requested mode before a later failed resize", async () => {
    const handle = await open(fixture(), "/new", { create: true, mode: 0o600 });
    try {
      expect(native.open).toHaveBeenCalledWith("/machine/new", constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      expect(await handle.stat()).toMatchObject({ size: 0 });
      expect(vol.statSync("/machine/new").mode & 0o777).toBe(0o600);
      await expect(handle.truncate(-1)).rejects.toMatchObject({ code: "EINVAL", path: "/new" });
      expect(vol.existsSync("/machine/new")).toBe(true);
      expect(hooks.truncates).toEqual([]);
    } finally { await handle.close(); }
  });

  it("does not change existing contents or mode when creation is allowed", async () => {
    vol.chmodSync("/machine/file", 0o640);
    const handle = await open(fixture(), "/file", { create: true, mode: 0o600 });
    try {
      expect(vol.statSync("/machine/file").mode & 0o777).toBe(0o640);
      expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
    } finally { await handle.close(); }
  });

  it("retains write authority after chmod without requiring read permission", async () => {
    vol.chmodSync("/machine/file", 0o200);
    const handle = await open();
    try {
      vol.chmodSync("/machine/file", 0);
      await handle.truncate(1);
      expect(await handle.stat()).toMatchObject({ size: 1 });
      expect(native.open).toHaveBeenCalledTimes(1);
    } finally { await handle.close(); }
  });

  it("preserves native acquisition permission errors even without a resize", async () => {
    hooks.failOpen = true;
    hooks.reason = Object.assign(new Error("/machine/file denied"), { code: "EACCES" });
    await expect(open()).rejects.toMatchObject({ code: "EACCES", path: "/file", syscall: "openResizeFile" });
    expect(hooks.truncates).toEqual([]);
    expect(hooks.closes).toBe(0);
  });

  it.each(["rename", "unlink", "replace"] as const)("pins the acquired inode through %s", async mutation => {
    vol.linkSync("/machine/file", "/machine/alias");
    const handle = await open();
    const before = await handle.stat();
    try {
      if (mutation === "rename") vol.renameSync("/machine/file", "/machine/moved");
      else vol.unlinkSync("/machine/file");
      if (mutation === "replace") vol.writeFileSync("/machine/file", "replacement");
      await handle.truncate(1);
      await handle.truncate(5);
      expect([...vol.readFileSync("/machine/alias") as Uint8Array]).toEqual([97, 0, 0, 0, 0]);
      expect(await handle.stat()).toMatchObject({ ino: before.ino, dev: before.dev, identityScope: before.identityScope, size: 5 });
      if (mutation === "replace") expect(vol.readFileSync("/machine/file", "utf8")).toBe("replacement");
      expect(native.open).toHaveBeenCalledTimes(1);
    } finally { await handle.close(); }
  });

  it("retains a fully unlinked inode and never touches its replacement", async () => {
    const handle = await open();
    const before = await handle.stat();
    try {
      vol.unlinkSync("/machine/file");
      vol.writeFileSync("/machine/file", "replacement");
      await handle.truncate(6);
      expect(await handle.stat()).toMatchObject({ ino: before.ino, size: 6, nlink: 0 });
      expect(vol.readFileSync("/machine/file", "utf8")).toBe("replacement");
    } finally { await handle.close(); }
  });

  it("dispatches same-size ftruncate rather than skipping native timestamp effects", async () => {
    const handle = await open();
    try {
      await handle.truncate(3);
      expect(hooks.truncates).toEqual([3]);
      expect(await handle.stat()).toMatchObject({ size: 3 });
    } finally { await handle.close(); }
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, "1"])("rejects invalid lengths before native work: %s", async length => {
    const handle = await open();
    try {
      await expect(handle.truncate(length as number)).rejects.toMatchObject({ code: "EINVAL", path: "/file", syscall: "ftruncate" });
      expect(hooks.truncates).toEqual([]);
    } finally { await handle.close(); }
  });

  it.each([-1, 0.5, NaN, Infinity])("rejects invalid creation mode before host work: %s", async mode => {
    await expect(open(fixture(), "/new", { create: true, mode })).rejects.toMatchObject({ code: "EINVAL", path: "/new" });
    expect(native.realpath).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
  });

  it.each([0, 1, "true", null])("rejects invalid create options rather than granting creation: %s", async create => {
    await expect(open(fixture(), "/new", { create: create as never })).rejects.toMatchObject({ code: "EINVAL" });
    expect(native.open).not.toHaveBeenCalled();
    expect(native.realpath).not.toHaveBeenCalled();
  });

  it("delegates valid safe-integer lengths without allocating a replacement buffer", async () => {
    const handle = await open();
    hooks.failTruncate = true;
    hooks.reason = Object.assign(new Error("native file limit"), { code: "EFBIG" });
    try {
      await expect(handle.truncate(Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ code: "EFBIG" });
      expect(hooks.truncates).toEqual([Number.MAX_SAFE_INTEGER]);
      expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
    } finally { await handle.close(); }
  });

  it("follows confined symlinks and their prefixes before dot-dot", async () => {
    vol.mkdirSync("/machine/directory/deep", { recursive: true });
    vol.writeFileSync("/machine/directory/file", "right");
    vol.symlinkSync("directory/deep", "/machine/link");
    const handle = await open(fixture(), "/link/../file");
    try {
      await handle.truncate(1);
      expect(vol.readFileSync("/machine/directory/file", "utf8")).toBe("r");
      expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
    } finally { await handle.close(); }
  });

  it.each(["/blocked/../file", "/via"])("prevents mutation through unsearchable dot-dot traversal: %s", async path => {
    vol.mkdirSync("/machine/blocked", { mode: 0 });
    vol.symlinkSync("blocked/../file", "/machine/via");
    hooks.deniedSearch = ["/machine/blocked"];
    const before = vol.statSync("/machine/file");
    const outcome = await (async () => {
      const handle = await open(fixture(), path, { create: false });
      try { await handle.truncate(1); }
      finally { await handle.close(); }
    })().then(() => ({ success: true }), error => ({ error }));
    expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
    expect(vol.statSync("/machine/file").ino).toBe(before.ino);
    expect(outcome).toMatchObject({ error: { code: "EACCES", syscall: "openResizeFile", path } });
    expect(native.open).not.toHaveBeenCalled();
    expect(hooks.truncates).toEqual([]);
  });

  it.each(["/blocked/.", "/blocked/..", "/via"])("checks native search authorization for literal or expanded dots: %s", async path => {
    vol.mkdirSync("/machine/blocked", { mode: 0 });
    vol.symlinkSync("blocked/.", "/machine/via");
    hooks.deniedSearch = ["/machine/blocked"];
    await expect(open(fixture(), path, { create: false })).rejects.toMatchObject({ code: "EACCES", path });
    expect(native.open).not.toHaveBeenCalled();
  });

  it.each(["/blocked/", "/via"])("does not require search inside a no-create final directory: %s", async path => {
    vol.mkdirSync("/machine/blocked", { mode: 0 });
    vol.symlinkSync("blocked/", "/machine/via");
    hooks.deniedSearch = ["/machine/blocked"];
    await expect(open(fixture(), path, { create: false })).rejects.toMatchObject({ code: "EISDIR", path });
    expect(native.lstat).not.toHaveBeenCalledWith("/machine/blocked/.");
  });

  it.each(["/loop/", "/bad/", "/loop-tail", "/bad-tail"])("rejects creation separators before following the final symlink: %s", async path => {
    vol.symlinkSync("loop", "/machine/loop");
    vol.symlinkSync("file/child", "/machine/bad");
    vol.symlinkSync("loop/", "/machine/loop-tail");
    vol.symlinkSync("bad/", "/machine/bad-tail");
    await expect(open(fixture(), path, { create: true })).rejects.toMatchObject({ code: "EISDIR", path });
    expect(native.open).not.toHaveBeenCalled();
    expect(native.readlink).not.toHaveBeenCalledWith("/machine/loop");
    expect(native.readlink).not.toHaveBeenCalledWith("/machine/bad");
    expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
  });

  it.each([
    ["/missing/leaf/", "ENOENT"], ["/file/leaf/", "ENOTDIR"],
    ["/blocked/leaf/", "EACCES"], ["/escape/leaf/", "EACCES"],
  ])("preserves parent traversal and confinement before creation separator errors: %s", async (path, code) => {
    vol.mkdirSync("/machine/blocked", { mode: 0 });
    vol.symlinkSync("/outside", "/machine/escape");
    hooks.deniedSearch = ["/machine/blocked"];
    await expect(open(fixture(), path, { create: true })).rejects.toMatchObject({ code, path });
    expect(native.open).not.toHaveBeenCalled();
    expect(vol.existsSync("/machine/leaf")).toBe(false);
    expect(vol.readFileSync("/outside/secret", "utf8")).toBe("secret");
  });

  it.each(["/file/", "/file//", "/new/"])("rejects creation separators without opening or creating: %s", async path => {
    await expect(open(fixture(), path, { create: true })).rejects.toMatchObject({ code: "EISDIR", path });
    expect(native.open).not.toHaveBeenCalled();
    expect(vol.existsSync("/machine/new")).toBe(false);
    expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
  });

  it("creates the confined referent of a dangling final symlink", async () => {
    vol.symlinkSync("new", "/machine/link");
    const handle = await open(fixture(), "/link", { create: true });
    try {
      await handle.truncate(2);
      expect(vol.lstatSync("/machine/link").isSymbolicLink()).toBe(true);
      expect(vol.statSync("/machine/new").size).toBe(2);
    } finally { await handle.close(); }
  });

  it.each(["/outside/secret", "../outside/secret"])("refuses escaping symlinks: %s", async target => {
    vol.symlinkSync(target, "/machine/link");
    await expect(open(fixture(), "/link", { create: true })).rejects.toMatchObject({ code: "EACCES", path: "/link" });
    expect(native.open).not.toHaveBeenCalled();
  });

  it.each(["", "/missing/child"])("does not create missing parents: %s", async path => {
    await expect(open(fixture(), path, { create: true })).rejects.toMatchObject({ code: "ENOENT", path });
    expect(vol.existsSync("/machine/new")).toBe(false);
    expect(vol.existsSync("/machine/missing")).toBe(false);
  });

  it.each(["EISDIR", "ENOTDIR", "EACCES"])("preserves no-create terminal separators and native open failure: %s", async code => {
    for (const [path, resolved] of [["/file/", "/machine/file/"], ["/file//", "/machine/file/"]]) {
      vi.mocked(native.open).mockRejectedValueOnce(Object.assign(new Error("native failure"), { code }));
      await expect(open(fixture(), path!, { create: false })).rejects.toMatchObject({ code, path });
      expect(native.open).toHaveBeenLastCalledWith(resolved, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o666);
      expect(vol.existsSync("/machine/new")).toBe(false);
      expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
    }
  });

  it("rejects a directory and closes a late observed nonregular file", async () => {
    await expect(open(fixture(), "/")).rejects.toMatchObject({ code: "EISDIR" });
    const previous = hooks.closes;
    hooks.mapStat = value => Object.assign(value, { isFile: () => false, isDirectory: () => false });
    await expect(open()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.closes).toBe(previous + 1);
  });
});

describe("Real preferred I/O metadata", () => {
  it.each([1, 4096, 8192, Number.MAX_SAFE_INTEGER])("preserves valid native block size on path and retained observations: %s", async blockSize => {
    hooks.blockSize = blockSize;
    const filesystem = fixture();
    const resize = await open(filesystem);
    const reader = await filesystem.openReadFile("/file");
    try {
      for (const stat of [await filesystem.stat("/file"), await filesystem.lstat("/file"), await resize.stat(), await reader.stat()]) {
        expect(stat.preferredIoBlockSize).toBe(blockSize);
      }
    } finally { await Promise.all([resize.close(), reader.close()]); }
  });

  it.each([undefined, null, 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "4096", 4096n])("leaves unavailable or invalid native block size unknown: %s", async blockSize => {
    hooks.blockSize = blockSize;
    const filesystem = fixture();
    const handle = await open(filesystem);
    try {
      expect(await filesystem.stat("/file")).not.toHaveProperty("preferredIoBlockSize");
      expect(await filesystem.lstat("/file")).not.toHaveProperty("preferredIoBlockSize");
      expect(await handle.stat()).not.toHaveProperty("preferredIoBlockSize");
    } finally { await handle.close(); }
  });
});

describe("Real retained-resize lifecycle and admission", () => {
  it("drains admitted stat and truncate before one close, synchronously refusing later work", async () => {
    const handle = await open();
    const statEntered = deferred(), truncateEntered = deferred(), statGate = deferred(), truncateGate = deferred();
    hooks.beforeStat = () => { statEntered.resolve(); return statGate.promise; };
    hooks.beforeTruncate = () => { truncateEntered.resolve(); return truncateGate.promise; };
    const stating = handle.stat(), resizing = handle.truncate(2);
    await Promise.all([statEntered.promise, truncateEntered.promise]);
    const closing = handle.close();
    try {
      expect(handle.close()).toBe(closing);
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF", path: "/file" });
      await expect(handle.truncate(-1)).rejects.toMatchObject({ code: "EBADF", path: "/file" });
      expect(hooks.closes).toBe(0);
      truncateGate.resolve();
      await resizing;
      expect(hooks.closes).toBe(0);
      statGate.resolve();
      expect(await stating).toMatchObject({ size: 2 });
      await closing;
      expect(handle.close()).toBe(closing);
      expect(hooks.closes).toBe(1);
    } finally {
      statGate.resolve(); truncateGate.resolve();
      await Promise.allSettled([stating, resizing, closing]);
    }
  });

  it.each([undefined, null, false, 0, ""])("preserves falsey open/stat/resize/close failures: %s", async reason => {
    hooks.reason = reason;
    hooks.failOpen = true;
    await expect(open()).rejects.toBe(reason);
    expect(hooks.closes).toBe(0);
    hooks.failOpen = false;
    hooks.failStat = true;
    hooks.failClose = true;
    await expect(open()).rejects.toBe(reason);
    expect(hooks.closes).toBe(1);
    hooks.failStat = false;
    hooks.failClose = false;
    const handle = await open();
    hooks.failTruncate = true;
    await expect(handle.truncate(1)).rejects.toBe(reason);
    hooks.failStat = true;
    await expect(handle.stat()).rejects.toBe(reason);
    hooks.failClose = true;
    hooks.closeReason = reason;
    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await expect(closing).rejects.toBe(reason);
    await expect(handle.close()).rejects.toBe(reason);
    expect(hooks.closes).toBe(2);
  });

  it.each([undefined, null, false, 0, ""])("closes late acquired handles before canceled open settles: %s", async reason => {
    const filesystem: FileSystem = fixture();
    expect(filesystem.openResizeFile).toBeTypeOf("function");
    const controller = new AbortController(), entered = deferred(), gate = deferred();
    hooks.afterOpen = () => { entered.resolve(); return gate.promise; };
    hooks.failClose = true;
    const opening = open(filesystem, "/created", { create: true, signal: controller.signal });
    const outcome = opening.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    controller.abort(reason);
    try { expect(hooks.closes).toBe(0); }
    finally { gate.resolve(); await outcome; }
    expect(await outcome).toEqual({ error: controller.signal.reason });
    expect(hooks.closes).toBe(1);
    expect(hooks.stats).toBe(0);
    expect(vol.existsSync("/machine/created")).toBe(true);
  });

  it.each(["stat", "truncate"] as const)("drains canceled native %s before close without rolling back completed effects", async operation => {
    const handle = await open(), controller = new AbortController(), entered = deferred(), gate = deferred();
    if (operation === "stat") hooks.beforeStat = () => { entered.resolve(); return gate.promise; };
    else hooks.beforeTruncate = () => { entered.resolve(); return gate.promise; };
    const pending = operation === "stat" ? handle.stat({ signal: controller.signal }) : handle.truncate(1, { signal: controller.signal });
    const outcome = pending.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    controller.abort(false);
    const closing = handle.close();
    try { expect(hooks.closes).toBe(0); }
    finally { gate.resolve(); await Promise.allSettled([pending, closing]); }
    expect(await outcome).toEqual({ error: false });
    expect(hooks.closes).toBe(1);
    expect(vol.statSync("/machine/file").size).toBe(operation === "stat" ? 3 : 1);
  });

  it("drains acquisition fstat and delayed cleanup before preserving cancellation", async () => {
    const controller = new AbortController(), statEntered = deferred(), statGate = deferred(), closeEntered = deferred(), closeGate = deferred();
    const filesystem: FileSystem = fixture();
    expect(filesystem.openResizeFile).toBeTypeOf("function");
    hooks.beforeStat = () => { statEntered.resolve(); return statGate.promise; };
    hooks.beforeClose = () => { closeEntered.resolve(); return closeGate.promise; };
    hooks.failClose = true;
    let settled = false;
    const opening = open(filesystem, "/file", { signal: controller.signal });
    const outcome = opening.then(() => ({ ok: true }), error => ({ error })).finally(() => { settled = true; });
    await statEntered.promise;
    controller.abort(0);
    try {
      expect(hooks.closes).toBe(0);
      statGate.resolve();
      await closeEntered.promise;
      expect(settled).toBe(false);
    } finally { statGate.resolve(); closeGate.resolve(); await outcome; }
    expect(await outcome).toEqual({ error: 0 });
    expect(hooks.closes).toBe(1);
  });

  it("preserves a failed acquisition and created file through delayed failing cleanup", async () => {
    const filesystem: FileSystem = fixture();
    expect(filesystem.openResizeFile).toBeTypeOf("function");
    const entered = deferred(), gate = deferred();
    hooks.failStat = true;
    hooks.reason = false;
    hooks.failClose = true;
    hooks.beforeClose = () => { entered.resolve(); return gate.promise; };
    let settled = false;
    const opening = open(filesystem, "/created", { create: true });
    const outcome = opening.then(() => ({ ok: true }), error => ({ error })).finally(() => { settled = true; });
    await entered.promise;
    try {
      expect(settled).toBe(false);
      expect(vol.existsSync("/machine/created")).toBe(true);
    } finally { gate.resolve(); await outcome; }
    expect(await outcome).toEqual({ error: false });
    expect(hooks.closes).toBe(1);
  });

  it("drains rejected mutation work before releasing a closing handle", async () => {
    const handle = await open(), entered = deferred(), gate = deferred();
    hooks.beforeTruncate = () => { entered.resolve(); return gate.promise; };
    hooks.failTruncate = true;
    hooks.reason = null;
    const resizing = handle.truncate(0);
    const outcome = resizing.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    const closing = handle.close();
    try { expect(hooks.closes).toBe(0); }
    finally { gate.resolve(); await Promise.allSettled([resizing, closing]); }
    expect(await outcome).toEqual({ error: null });
    await closing;
    expect(hooks.closes).toBe(1);
    expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
  });

  it("does not admit native work for pre-aborted acquisition or operations", async () => {
    const controller = new AbortController();
    controller.abort(false);
    await expect(open(fixture(), "/new", { create: true, signal: controller.signal })).rejects.toBe(false);
    expect(native.realpath).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
    const handle = await open();
    try {
      const stats = hooks.stats;
      await expect(handle.stat({ signal: controller.signal })).rejects.toBe(false);
      await expect(handle.truncate(0, { signal: controller.signal })).rejects.toBe(false);
      expect(hooks.stats).toBe(stats);
      expect(hooks.truncates).toEqual([]);
    } finally { await handle.close(); }
  });

  it("shares a delayed failing close and never releases twice", async () => {
    const handle = await open(), entered = deferred(), gate = deferred();
    hooks.beforeClose = () => { entered.resolve(); return gate.promise; };
    hooks.failClose = true;
    hooks.closeReason = false;
    const closing = handle.close();
    const outcome = closing.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    try {
      expect(handle.close()).toBe(closing);
      await expect(handle.truncate(0)).rejects.toMatchObject({ code: "EBADF" });
    } finally { gate.resolve(); await outcome; }
    expect(await outcome).toEqual({ error: false });
    expect(handle.close()).toBe(closing);
    expect(hooks.closes).toBe(1);
  });

  it.each(["open", "stat", "truncate", "close"] as const)("sanitizes native %s errors to virtual paths without causes", async operation => {
    hooks.reason = Object.assign(new Error("failure /machine/file"), { code: "ENOSPC", path: "/machine/file" });
    hooks.closeReason = hooks.reason;
    if (operation === "open") hooks.failOpen = true;
    const handle = operation === "open" ? undefined : await open();
    if (operation === "stat") hooks.failStat = true;
    if (operation === "truncate") hooks.failTruncate = true;
    if (operation === "close") hooks.failClose = true;
    const pending = handle === undefined ? open() : operation === "stat" ? handle.stat() : operation === "truncate" ? handle.truncate(1) : handle.close();
    try {
      const failure = await pending.then(() => undefined, error => error);
      expect(failure).toMatchObject({ code: "ENOSPC", path: "/file" });
      expect(failure.message).not.toContain("/machine");
      expect(failure.cause).toBeUndefined();
    } finally { await handle?.close().catch(() => undefined); }
  });

  it.each(["truncate", "writeFile", "writeStream", "appendFile", "stat", "lstat", "realpath", "access"] as const)("refuses an overridden %s policy", async method => {
    const filesystem = fixture();
    vi.spyOn(filesystem, method).mockRejectedValue(new Error("policy"));
    await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(native.open).not.toHaveBeenCalled();
  });

  it("refuses subclasses and disabled or readonly capability observations", async () => {
    class CustomReal extends RealFileSystem {}
    await expect(open(new CustomReal("/machine"))).rejects.toMatchObject({ code: "ENOTSUP" });
    const disabled = fixture();
    Object.defineProperty(disabled, "capabilities", { value: { ...disabled.capabilities, retainedResize: false } });
    await expect(open(disabled)).rejects.toMatchObject({ code: "ENOTSUP" });
    const readonly = fixture();
    Object.defineProperty(readonly, "capabilities", { value: { ...readonly.capabilities, readOnly: true } });
    await expect(open(readonly)).rejects.toMatchObject({ code: "EROFS" });
    expect(native.open).not.toHaveBeenCalled();
  });

  it("closes an acquired resource when resize policy changes during acquisition", async () => {
    const filesystem = fixture();
    hooks.afterOpen = () => { filesystem.truncate = async () => { throw new Error("policy"); }; };
    await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.closes).toBe(1);
    expect(hooks.truncates).toEqual([]);
  });

  it("refuses prototype policy replacement without calling it", async () => {
    const changed = vi.spyOn(RealFileSystem.prototype, "access").mockRejectedValue(new Error("policy"));
    await expect(open()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(changed).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
  });
});
