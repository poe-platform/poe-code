import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { constants, type Stats } from "node:fs";
import * as native from "node:fs/promises";
import { RealFileSystem } from "../src/fs/real/index.js";
import type { OpenReadFileOptions } from "../src/contracts/filesystem.js";

const hooks = vi.hoisted(() => ({
  afterOpen: undefined as (() => void | Promise<void>) | undefined,
  beforeStat: undefined as (() => void | Promise<void>) | undefined,
  beforeClose: undefined as (() => void | Promise<void>) | undefined,
  mapStat: undefined as ((stats: Stats) => Stats) | undefined,
  failStat: false, failClose: false,
  reason: undefined as unknown, closeReason: undefined as unknown,
  stats: 0, reads: 0, closes: 0,
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    realpath: vi.fn(fs.promises.realpath.bind(fs.promises)),
    open: vi.fn(async (filename: string, flags: number) => {
      const handle = await fs.promises.open(filename, flags);
      const stat = handle.stat.bind(handle);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.stat = async () => {
        hooks.stats++;
        await hooks.beforeStat?.();
        if (hooks.failStat) throw hooks.reason;
        const value = await stat() as Stats;
        return hooks.mapStat?.(value) ?? value;
      };
      handle.read = async (buffer, offset, length, position) => {
        hooks.reads++;
        return read(buffer, offset, length, position);
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

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "abc", "/outside/secret": "secret" });
  vol.mkdirSync("/machine/directory");
  Object.assign(hooks, {
    afterOpen: undefined, beforeStat: undefined, beforeClose: undefined, mapStat: undefined,
    failStat: false, failClose: false, reason: undefined, closeReason: undefined,
    stats: 0, reads: 0, closes: 0,
  });
  vi.clearAllMocks();
});

afterEach(() => { vi.restoreAllMocks(); });

describe("Real opt-in retained directory reads", () => {
  it("acquires an opted-in directory with pinned native stat and native seek availability", async () => {
    const filesystem = new RealFileSystem("/machine");
    const before = await filesystem.stat("/directory");
    const handle = await filesystem.openReadFile("/directory", { allowDirectory: true });
    try {
      expect(await handle.stat()).toEqual(before);
      expect(Object.keys(handle).sort()).toEqual(["close", "read", "seekEnd", "stat"]);
      expect(handle.seekEnd).toBeTypeOf("function");
      expect(native.open).toHaveBeenCalledExactlyOnceWith("/machine/directory", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EISDIR", syscall: "read", path: "/directory" });
      expect(hooks.reads).toBe(0);
    } finally { await handle.close(); }
    expect(hooks.closes).toBe(1);
  });

  it.each([undefined, false, 1, "true", {}])("requires literal true, not %s", async allowDirectory => {
    const options = (allowDirectory === undefined ? {} : { allowDirectory }) as OpenReadFileOptions;
    await expect(new RealFileSystem("/machine").openReadFile("/directory", options)).rejects.toMatchObject({ code: "EISDIR", syscall: "openReadFile", path: "/directory" });
    expect(hooks.closes).toBe(1);
    expect(hooks.reads).toBe(0);
  });

  it("does not change ordinary readFile or readStream directory rejection", async () => {
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.readFile("/directory")).rejects.toMatchObject({ code: "EISDIR", syscall: "readFile" });
    const stream = filesystem.readStream("/directory")[Symbol.asyncIterator]();
    try { await expect(stream.next()).rejects.toMatchObject({ code: "EISDIR", syscall: "readStream" }); }
    finally { await stream.return?.(); }
    expect(hooks.closes).toBe(2);
    expect(hooks.reads).toBe(0);
  });

  it("keeps regular-file positional reads available with opt-in", async () => {
    const handle = await new RealFileSystem("/machine").openReadFile("/file", { allowDirectory: true });
    try { expect(await handle.read(1, 2)).toEqual(new TextEncoder().encode("bc")); }
    finally { await handle.close(); }
  });

  it("keeps the acquired directory inode across rename, removal and pathname replacement", async () => {
    const filesystem = new RealFileSystem("/machine");
    const handle = await filesystem.openReadFile("/directory", { allowDirectory: true });
    try {
      const before = await handle.stat();
      await filesystem.rename("/directory", "/moved");
      vol.writeFileSync("/machine/directory", "replacement");
      expect(await handle.stat()).toMatchObject({ type: "directory", ino: before.ino, dev: before.dev, identityScope: before.identityScope });
      expect((await filesystem.stat("/directory")).ino).not.toBe(before.ino);
      await filesystem.rmdir("/moved");
      expect(await handle.stat()).toMatchObject({ type: "directory", ino: before.ino, dev: before.dev, identityScope: before.identityScope });
      await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EISDIR" });
      expect(hooks.reads).toBe(0);
      expect(vol.readFileSync("/machine/directory", "utf8")).toBe("replacement");
    } finally { await handle.close(); }
  });

  it("follows confined aliases but does not admit escaping or unsupported targets", async () => {
    const filesystem = new RealFileSystem("/machine");
    vol.symlinkSync("directory", "/machine/alias");
    const handle = await filesystem.openReadFile("/alias", { allowDirectory: true });
    try { expect(await handle.stat()).toMatchObject({ type: "directory", ino: vol.statSync("/machine/directory").ino }); }
    finally { await handle.close(); }
    vol.symlinkSync("/outside", "/machine/escape");
    await expect(filesystem.openReadFile("/escape", { allowDirectory: true })).rejects.toMatchObject({ code: "EACCES" });
    expect(native.open).toHaveBeenCalledTimes(1);
    hooks.mapStat = stats => Object.assign(stats, { isFile: () => false, isDirectory: () => false });
    await expect(filesystem.openReadFile("/file", { allowDirectory: true })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.closes).toBe(2);
  });

  it("validates read bounds before directory denial without allocating or dispatching", async () => {
    const handle = await new RealFileSystem("/machine").openReadFile("/directory", { allowDirectory: true });
    try {
      for (const [position, length] of [[-1, 1], [0, 0], [0, 1.5], [Number.MAX_SAFE_INTEGER, 1]]) {
        await expect(handle.read(position!, length!)).rejects.toMatchObject({ code: "EINVAL", syscall: "read" });
      }
      await expect(handle.read(0, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ code: "EISDIR" });
      expect(hooks.reads).toBe(0);
    } finally { await handle.close(); }
  });

  it("stops admission synchronously and drains a reentrant stat before one shared close", async () => {
    const handle = await new RealFileSystem("/machine").openReadFile("/directory", { allowDirectory: true });
    const entered = deferred(), release = deferred();
    let closing: Promise<void> | undefined;
    hooks.beforeStat = () => { closing = handle.close(); entered.resolve(); return release.promise; };
    const stating = handle.stat();
    try {
      await entered.promise;
      expect(hooks.closes).toBe(0);
      expect(handle.close()).toBe(closing);
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
      await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EBADF" });
    } finally { release.resolve(); await Promise.allSettled([stating, closing]); }
    expect(await stating).toMatchObject({ type: "directory" });
    await closing;
    expect(hooks.closes).toBe(1);
    expect(handle.close()).toBe(closing);
  });

  it.each([false, null, 0, "", NaN])("preserves falsey cancellation and held-stat cleanup: %s", async reason => {
    const filesystem = new RealFileSystem("/machine");
    const controller = new AbortController();
    controller.abort(reason);
    await expect(filesystem.openReadFile("/directory", { allowDirectory: true, signal: controller.signal })).rejects.toBe(reason);
    expect(native.open).not.toHaveBeenCalled();
    const handle = await filesystem.openReadFile("/directory", { allowDirectory: true });
    const active = new AbortController(), entered = deferred(), release = deferred();
    hooks.beforeStat = () => { entered.resolve(); return release.promise; };
    const stating = handle.stat({ signal: active.signal });
    const result = stating.then(value => ({ value }), error => ({ error }));
    let closing: Promise<void> | undefined;
    try {
      await entered.promise;
      active.abort(reason);
      closing = handle.close();
      expect(hooks.closes).toBe(0);
      await expect(handle.read(0, 1, { signal: active.signal })).rejects.toBe(reason);
      await expect(handle.stat({ signal: active.signal })).rejects.toBe(reason);
    } finally { release.resolve(); await result; await (closing ?? handle.close()); }
    expect(await result).toEqual({ error: reason });
    expect(hooks.closes).toBe(1);
  });

  it.each(["open", "stat"] as const)("drains a late acquired directory canceled during %s", async phase => {
    const controller = new AbortController(), entered = deferred(), release = deferred();
    const hook = () => { entered.resolve(); return release.promise; };
    if (phase === "open") hooks.afterOpen = hook;
    else hooks.beforeStat = hook;
    const opening = new RealFileSystem("/machine").openReadFile("/directory", { allowDirectory: true, signal: controller.signal });
    let settled = false;
    const result = opening.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    try {
      await entered.promise;
      controller.abort(false);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(hooks.closes).toBe(0);
    } finally { release.resolve(); await result; }
    expect(await result).toEqual({ error: false });
    expect(hooks.closes).toBe(1);
  });

  it.each([false, null, 0, "", NaN])("observes opt-in getter cancellation before native admission: %s", async reason => {
    for (const allowDirectory of [true, false]) {
      const controller = new AbortController();
      const options = { signal: controller.signal, get allowDirectory() { controller.abort(reason); return allowDirectory; } };
      await expect(new RealFileSystem("/machine").openReadFile("/directory", options)).rejects.toBe(reason);
    }
    expect(native.realpath).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
    expect(hooks.closes).toBe(0);
  });

  it("captures signal and directory intent once before native work", async () => {
    const controller = new AbortController();
    let signalReads = 0, intentReads = 0;
    const options = {
      get signal() { signalReads++; return controller.signal; },
      get allowDirectory() { intentReads++; expect(native.open).not.toHaveBeenCalled(); return true; },
    };
    const handle = await new RealFileSystem("/machine").openReadFile("/directory", options);
    try {
      expect(signalReads).toBe(1);
      expect(intentReads).toBe(1);
      expect(await handle.stat()).toMatchObject({ type: "directory" });
    } finally { await handle.close(); }
  });

  it.each([false, null, 0, "", NaN, undefined])("preserves falsey stat and shared close failures: %s", async reason => {
    const handle = await new RealFileSystem("/machine").openReadFile("/directory", { allowDirectory: true });
    hooks.failStat = true;
    hooks.reason = reason;
    try { await expect(handle.stat()).rejects.toBe(reason); }
    finally {
      hooks.failClose = true;
      hooks.closeReason = reason;
      const closing = handle.close();
      expect(handle.close()).toBe(closing);
      await expect(closing).rejects.toBe(reason);
      expect(handle.close()).toBe(closing);
    }
    expect(hooks.closes).toBe(1);
  });
});
