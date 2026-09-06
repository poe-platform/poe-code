import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { constants, type Stats } from "node:fs";
import * as native from "node:fs/promises";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import type { FileReadHandle, FileSystem, FsOptions } from "../src/contracts/filesystem.js";

const hooks = vi.hoisted(() => ({
  afterOpen: undefined as (() => Promise<void> | void) | undefined,
  beforeRead: undefined as (() => Promise<void> | void) | undefined,
  beforeStat: undefined as (() => Promise<void> | void) | undefined,
  beforeClose: undefined as (() => Promise<void> | void) | undefined,
  mapStat: undefined as ((value: Stats) => Stats) | undefined,
  failOpen: false, failRead: false, failStat: false, failClose: false,
  reason: undefined as unknown,
  closeReason: undefined as unknown,
  reads: 0, stats: 0, closes: 0,
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    realpath: vi.fn(fs.promises.realpath.bind(fs.promises)),
    lstat: vi.fn(fs.promises.lstat.bind(fs.promises)),
    open: vi.fn(async (filename: string, flags: number) => {
      if (hooks.failOpen) throw hooks.reason;
      const handle = await fs.promises.open(filename, flags);
      const read = handle.read.bind(handle);
      const stat = handle.stat.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = async (buffer, offset, length, position) => {
        hooks.reads++;
        await hooks.beforeRead?.();
        if (hooks.failRead) throw hooks.reason;
        return read(buffer, offset, length, position);
      };
      handle.stat = async () => {
        hooks.stats++;
        await hooks.beforeStat?.();
        if (hooks.failStat) throw hooks.reason;
        const value = await stat();
        return hooks.mapStat?.(value as Stats) ?? value;
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

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function fixture(adapter: "Memory" | "Real"): Promise<FileSystem> {
  const filesystem = adapter === "Memory" ? new MemoryFileSystem() : new RealFileSystem("/machine");
  if (adapter === "Real") vol.writeFileSync("/machine/file", "abc");
  else await filesystem.writeFile("/file", encode("abc"));
  return filesystem;
}

async function open(filesystem: FileSystem, path = "/file", options?: FsOptions): Promise<FileReadHandle> {
  expect(filesystem.openReadFile, "optional retained-reader API").toBeTypeOf("function");
  return filesystem.openReadFile!(path, options);
}

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/.keep": "", "/outside/secret": "secret" });
  Object.assign(hooks, {
    afterOpen: undefined, beforeRead: undefined, beforeStat: undefined, beforeClose: undefined,
    mapStat: undefined, failOpen: false, failRead: false, failStat: false, failClose: false,
    reason: undefined, closeReason: new Error("secondary close failure"), reads: 0, stats: 0, closes: 0,
  });
  vi.clearAllMocks();
});

afterEach(() => { vi.restoreAllMocks(); });

for (const adapter of ["Memory", "Real"] as const) {
  describe(`${adapter} retained reader`, () => {
    it("exposes only stat/read/close and preserves the existing stat identity", async () => {
      const filesystem = await fixture(adapter);
      const before = await filesystem.stat("/file");
      const handle = await open(filesystem);
      try {
        expect(filesystem.capabilities.retainedRead).toBe(true);
        expect(Object.keys(handle).sort()).toEqual(["close", "read", "stat"]);
        expect(await handle.stat()).toMatchObject({ size: 3, type: "file", identityScope: before.identityScope, dev: before.dev, ino: before.ino });
        expect(before.identityScope).toBeDefined();
      } finally { await handle.close(); }
    });

    it("returns owned positional bytes and fresh metadata across append and EOF", async () => {
      const filesystem = await fixture(adapter);
      const handle = await open(filesystem);
      try {
        const before = await handle.stat();
        const first = await handle.read(1, 2);
        expect(decode(first)).toBe("bc");
        first.fill(0);
        expect(decode(await handle.read(0, 8))).toBe("abc");
        expect(await handle.read(3, 2)).toHaveLength(0);
        if (adapter === "Real") vol.appendFileSync("/machine/file", "de");
        else await filesystem.appendFile("/file", encode("de"));
        expect(decode(await handle.read(3, 2))).toBe("de");
        const after = await handle.stat();
        expect(after).not.toBe(before);
        expect(before.size).toBe(3);
        expect(after.size).toBe(5);
        expect(after.identityScope).toBe(before.identityScope);
      } finally { await handle.close(); }
    });

    it("pins the resource across rename, replacement, unlink and truncation", async () => {
      const filesystem = await fixture(adapter);
      await filesystem.link!("/file", "/alias");
      const handle = await open(filesystem);
      try {
        const before = await handle.stat();
        await filesystem.rename("/file", "/old");
        await filesystem.writeFile("/file", encode("new"));
        await filesystem.rm("/old");
        if (adapter === "Real") vol.appendFileSync("/machine/alias", "d");
        else await filesystem.appendFile("/alias", encode("d"));
        expect(decode(await handle.read(0, 8))).toBe("abcd");
        expect((await handle.stat()).ino).toBe(before.ino);
        expect((await filesystem.stat("/file")).ino).not.toBe(before.ino);
        await filesystem.truncate!("/alias", 0);
        expect((await handle.stat()).size).toBe(0);
        expect(await handle.read(0, 1)).toHaveLength(0);
        if (adapter === "Real") vol.appendFileSync("/machine/alias", "reset");
        else await filesystem.appendFile("/alias", encode("reset"));
        await filesystem.rm("/alias");
        expect(decode(await handle.read(0, 8))).toBe("reset");
        await expect(filesystem.stat("/alias")).rejects.toMatchObject({ code: "ENOENT" });
        if (adapter === "Memory") expect((await handle.stat()).nlink).toBe(0);
      } finally { await handle.close(); }
    });

    it("keeps pinned stat/read independent of subsequent pathname methods", async () => {
      const filesystem = await fixture(adapter);
      const handle = await open(filesystem);
      try {
        filesystem.stat = vi.fn(async () => { throw new Error("path stat must not run"); });
        filesystem.readFile = vi.fn(async () => { throw new Error("path read must not run"); });
        expect((await handle.stat()).size).toBe(3);
        expect(decode(await handle.read(0, 3))).toBe("abc");
      } finally { await handle.close(); }
    });

    it("closes admission synchronously and shares an idempotent close promise", async () => {
      const handle = await open(await fixture(adapter));
      const closing = handle.close();
      expect(handle.close()).toBe(closing);
      await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EBADF" });
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
      await closing;
      if (adapter === "Real") expect(hooks.closes).toBe(1);
    });

    it.each([
      [-1, 1], [0.5, 1], [NaN, 1], [Infinity, 1], [Number.MAX_SAFE_INTEGER + 1, 1],
      [0, 0], [0, -1], [0, 0.5], [0, NaN], [0, Infinity], [0, Number.MAX_SAFE_INTEGER + 1],
      [Number.MAX_SAFE_INTEGER, 1], [Number.MAX_SAFE_INTEGER - 1, 2],
    ])("rejects range (%s, %s) before native reading", async (position, maxBytes) => {
      const handle = await open(await fixture(adapter));
      try {
        await expect(handle.read(position, maxBytes)).rejects.toMatchObject({ code: "EINVAL", syscall: "read", path: "/file" });
        expect(hooks.reads).toBe(0);
      } finally { await handle.close(); }
    });

    it.each([undefined, null, false, 0, ""])("preserves pre-abort before open and invalid read: %s", async reason => {
      const filesystem = await fixture(adapter);
      const controller = new AbortController();
      controller.abort(reason);
      vi.clearAllMocks();
      await expect(open(filesystem, "/file", { signal: controller.signal })).rejects.toBe(controller.signal.reason);
      expect(native.open).not.toHaveBeenCalled();
      expect(native.lstat).not.toHaveBeenCalled();
      expect(native.realpath).not.toHaveBeenCalled();
      const handle = await open(filesystem);
      try {
        const stats = hooks.stats;
        await expect(handle.read(-1, 0, { signal: controller.signal })).rejects.toBe(controller.signal.reason);
        await expect(handle.stat({ signal: controller.signal })).rejects.toBe(controller.signal.reason);
        expect(hooks.reads).toBe(0);
        expect(hooks.stats).toBe(stats);
      } finally { await handle.close(); }
    });

    it("does not attach acquisition cancellation to later operations", async () => {
      const controller = new AbortController();
      const handle = await open(await fixture(adapter), "/file", { signal: controller.signal });
      controller.abort(false);
      try { expect(decode(await handle.read(0, 3))).toBe("abc"); }
      finally { await handle.close(); }
    });

    it("preserves symlink, missing, directory, non-directory and loop errors", async () => {
      const filesystem = await fixture(adapter);
      await filesystem.symlink!("file", "/link");
      await filesystem.symlink!("missing", "/dangling");
      await filesystem.symlink!("loop", "/loop");
      const handle = await open(filesystem, "/link");
      try { expect(decode(await handle.read(0, 3))).toBe("abc"); }
      finally { await handle.close(); }
      for (const [path, code] of [["/missing", "ENOENT"], ["/dangling", "ENOENT"], ["/", "EISDIR"], ["/file/child", "ENOTDIR"], ["/loop", "ELOOP"]]) {
        await expect(open(filesystem, path)).rejects.toMatchObject({ code, path });
      }
    });

    it.each(["readFile", "readStream", "stat", "lstat", "realpath", "access"])("refuses modified %s without invoking its getter", async method => {
      const filesystem = await fixture(adapter);
      const getter = vi.fn(() => { throw new Error("modified policy"); });
      Object.defineProperty(filesystem, method, { configurable: true, get: getter });
      vi.clearAllMocks();
      await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(getter).not.toHaveBeenCalled();
      expect(native.open).not.toHaveBeenCalled();
      expect(native.lstat).not.toHaveBeenCalled();
    });

    it("refuses inherited stock acquisition on a subclass", async () => {
      class CustomMemory extends MemoryFileSystem {}
      class CustomReal extends RealFileSystem {}
      const filesystem = adapter === "Memory" ? new CustomMemory() : new CustomReal("/machine");
      await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(native.open).not.toHaveBeenCalled();
    });

    it("refuses an explicit retained capability mask", async () => {
      const filesystem = await fixture(adapter);
      Object.defineProperty(filesystem, "capabilities", { value: { ...filesystem.capabilities, retainedRead: false } });
      await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(native.open).not.toHaveBeenCalled();
    });

    it("refuses prototype-level read policy replacement", async () => {
      const filesystem = await fixture(adapter);
      const prototype = adapter === "Memory" ? MemoryFileSystem.prototype : RealFileSystem.prototype;
      const changed = vi.spyOn(prototype, "access").mockImplementation(async () => { throw new Error("policy"); });
      await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(changed).not.toHaveBeenCalled();
      expect(native.open).not.toHaveBeenCalled();
    });

    it("resolves symlink prefixes before dot-dot instead of lexical folding", async () => {
      const filesystem = await fixture(adapter);
      await filesystem.mkdir("/dir/deeper", { recursive: true });
      await filesystem.writeFile("/dir/sibling", encode("inside"));
      await filesystem.writeFile("/sibling", encode("wrong"));
      await filesystem.symlink!("dir/deeper", "/hop");
      const handle = await open(filesystem, "/hop/../sibling");
      try { expect(decode(await handle.read(0, 8))).toBe("inside"); }
      finally { await handle.close(); }
    });

    it("leaves finite streaming unchanged", async () => {
      const filesystem = await fixture(adapter);
      const chunks: Uint8Array[] = [];
      for await (const chunk of filesystem.readStream!("/file", { start: 1, endExclusive: 3, chunkSize: 1 })) chunks.push(chunk);
      expect(chunks.map(decode)).toEqual(["b", "c"]);
    });
  });
}

describe("Real retained-reader admission and lifecycle", () => {
  it("uses confined native open flags and refuses escaping symlinks", async () => {
    const filesystem = await fixture("Real");
    const handle = await open(filesystem);
    await handle.close();
    expect(native.open).toHaveBeenCalledWith("/machine/file", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    vol.symlinkSync("/outside/secret", "/machine/escape");
    vi.clearAllMocks();
    await expect(open(filesystem, "/escape")).rejects.toMatchObject({ code: "EACCES", path: "/escape" });
    expect(native.open).not.toHaveBeenCalled();
  });

  it.each(["directory", "special"])("closes a post-open %s once", async type => {
    const filesystem = await fixture("Real");
    hooks.mapStat = value => Object.assign(value, { isFile: () => false, isDirectory: () => type === "directory" });
    await expect(open(filesystem)).rejects.toMatchObject({ code: type === "directory" ? "EISDIR" : "ENOTSUP", path: "/file" });
    expect(hooks.closes).toBe(1);
  });

  it("preserves valid zero identity and leaves invalid identity unknown", async () => {
    const filesystem = await fixture("Real");
    const handle = await open(filesystem);
    try {
      hooks.mapStat = value => Object.assign(value, { dev: 0, ino: 0 });
      expect(await handle.stat()).toMatchObject({ dev: 0, ino: 0, identityScope: Symbol.for("virtual-bash.fs.native") });
      hooks.mapStat = value => Object.assign(value, { ino: Number.MAX_SAFE_INTEGER + 1 });
      expect((await handle.stat()).identityScope).toBeUndefined();
    } finally { await handle.close(); }
  });

  it("drains admitted stat and read before one native close", async () => {
    const handle = await open(await fixture("Real"));
    const readEntered = deferred();
    const statEntered = deferred();
    const readGate = deferred();
    const statGate = deferred();
    hooks.beforeRead = () => { readEntered.resolve(); return readGate.promise; };
    hooks.beforeStat = () => { statEntered.resolve(); return statGate.promise; };
    const reading = handle.read(0, 3);
    const stating = handle.stat();
    await Promise.all([readEntered.promise, statEntered.promise]);
    const closing = handle.close();
    try {
      expect(handle.close()).toBe(closing);
      expect(hooks.closes).toBe(0);
      await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EBADF" });
      readGate.resolve();
      expect(decode(await reading)).toBe("abc");
      expect(hooks.closes).toBe(0);
      statGate.resolve();
      expect((await stating).size).toBe(3);
      await closing;
      expect(hooks.closes).toBe(1);
    } finally {
      readGate.resolve();
      statGate.resolve();
      await Promise.allSettled([reading, stating, closing]);
    }
  });

  it.each([undefined, null, false, 0, ""])("drains a late aborted open and retains its reason over close failure: %s", async reason => {
    const filesystem = await fixture("Real");
    expect(filesystem.openReadFile).toBeTypeOf("function");
    const entered = deferred();
    const gate = deferred();
    hooks.afterOpen = () => { entered.resolve(); return gate.promise; };
    hooks.failClose = true;
    hooks.closeReason = new Error("secondary close failure");
    const controller = new AbortController();
    const opening = open(filesystem, "/file", { signal: controller.signal });
    const outcome = opening.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    controller.abort(reason);
    try { expect(hooks.closes).toBe(0); }
    finally { gate.resolve(); await outcome; }
    expect(await outcome).toEqual({ error: controller.signal.reason });
    expect(hooks.closes).toBe(1);
    expect(hooks.stats).toBe(0);
  });

  it.each([undefined, null, false, 0, ""])("retains falsey open/stat/read/close failures: %s", async reason => {
    const filesystem = await fixture("Real");
    hooks.reason = reason;
    hooks.failOpen = true;
    await expect(open(filesystem)).rejects.toBe(reason);
    expect(hooks.closes).toBe(0);
    hooks.failOpen = false;
    hooks.failStat = true;
    hooks.failClose = true;
    await expect(open(filesystem)).rejects.toBe(reason);
    expect(hooks.closes).toBe(1);
    hooks.failStat = false;
    hooks.failClose = false;
    const handle = await open(filesystem);
    hooks.failRead = true;
    await expect(handle.read(0, 1)).rejects.toBe(reason);
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

  it("preserves cancellation while draining an admitted native read", async () => {
    const handle = await open(await fixture("Real"));
    const entered = deferred();
    const gate = deferred();
    hooks.beforeRead = () => { entered.resolve(); return gate.promise; };
    const controller = new AbortController();
    const reading = handle.read(0, 3, { signal: controller.signal });
    const outcome = reading.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    controller.abort(false);
    const closing = handle.close();
    try { expect(hooks.closes).toBe(0); }
    finally { gate.resolve(); await Promise.allSettled([reading, closing]); }
    expect(await outcome).toEqual({ error: false });
    await closing;
    expect(hooks.closes).toBe(1);
  });

  it("keeps native errors virtual and does not expose native causes", async () => {
    const handle = await open(await fixture("Real"));
    hooks.failRead = true;
    hooks.reason = Object.assign(new Error("secret /machine/file"), { code: "EIO", path: "/machine/file" });
    try {
      const failure = await handle.read(0, 1).catch(error => error);
      expect(failure).toMatchObject({ code: "EIO", path: "/file" });
      expect(failure.message).not.toContain("/machine");
      expect(failure.cause).toBeUndefined();
    } finally { await handle.close(); }
  });

  it("waits for a delayed failing close and never releases twice", async () => {
    const handle = await open(await fixture("Real"));
    const entered = deferred();
    const gate = deferred();
    hooks.beforeClose = () => { entered.resolve(); return gate.promise; };
    hooks.failClose = true;
    hooks.closeReason = false;
    const closing = handle.close();
    const outcome = closing.then(() => ({ ok: true }), error => ({ error }));
    await entered.promise;
    try {
      expect(handle.close()).toBe(closing);
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
      expect(hooks.closes).toBe(1);
    } finally { gate.resolve(); await outcome; }
    expect(await outcome).toEqual({ error: false });
    await expect(handle.close()).rejects.toBe(false);
    expect(hooks.closes).toBe(1);
  });

  it("closes an acquisition whose stock policy changes during native open", async () => {
    const filesystem = await fixture("Real");
    hooks.afterOpen = () => { filesystem.readFile = async () => { throw new Error("policy"); }; };
    await expect(open(filesystem)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.closes).toBe(1);
    expect(hooks.reads).toBe(0);
  });
});

describe("Memory retained-reader admission", () => {
  it("enforces file and traversal read authority at acquisition", async () => {
    const filesystem = await fixture("Memory");
    await filesystem.chmod!("/file", 0);
    await expect(open(filesystem)).rejects.toMatchObject({ code: "EACCES", path: "/file" });
    await filesystem.mkdir("/dir");
    await filesystem.writeFile("/dir/file", encode("private"));
    await filesystem.chmod!("/dir", 0);
    await expect(open(filesystem, "/dir/file")).rejects.toMatchObject({ code: "EACCES" });
  });
});
