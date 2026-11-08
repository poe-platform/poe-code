import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import { RealFileSystem } from "../src/fs/real/index.js";
import type { FileReadHandle, FileResizeHandle } from "../src/contracts/filesystem.js";

const hooks = vi.hoisted(() => ({
  load: vi.fn(), seek: vi.fn(), binding: {} as object,
  descriptor: -1, opened: 0, closed: 0, stats: 0,
  onDescriptor: undefined as (() => void) | undefined,
  failClose: false, closeReason: undefined as unknown,
}));

vi.mock("../dist/native/fs-seek/loader.mjs", () => ({ loadBinding: hooks.load }));
vi.mock("node:module", () => ({ createRequire: () => { throw new Error("Native loading is forbidden in memfs tests"); } }));
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, open: vi.fn(async (filename: string, flags: number, mode?: number) => {
    const handle = await fs.promises.open(filename, flags, mode);
    const descriptor = handle.fd;
    let currentDescriptor = descriptor;
    hooks.descriptor = descriptor;
    hooks.opened++;
    Object.defineProperty(handle, "fd", { configurable: true, get() {
      const callback = hooks.onDescriptor;
      hooks.onDescriptor = undefined;
      callback?.();
      return currentDescriptor;
    }, set(value: number) { currentDescriptor = value; } });
    const close = handle.close.bind(handle), stat = handle.stat.bind(handle);
    handle.close = async () => {
      await close();
      hooks.closed++;
      if (hooks.failClose) throw hooks.closeReason;
    };
    handle.stat = async () => {
      hooks.stats++;
      const value = await stat();
      if (value.isDirectory()) Object.defineProperty(value, "size", { value: 0 });
      return value;
    };
    return handle;
  }) };
});
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vol.reset();
  vol.fromJSON({ "/machine/file": "abc" });
  vol.mkdirSync("/machine/directory");
  Object.assign(hooks, { descriptor: -1, opened: 0, closed: 0, stats: 0, onDescriptor: undefined, failClose: false, closeReason: undefined });
  hooks.binding = { seekEnd: hooks.seek };
  hooks.load.mockImplementation(async () => hooks.binding);
  hooks.seek.mockImplementation(async function (this: unknown, descriptor: number) {
    expect(this).toBe(hooks.binding);
    expect(descriptor).toBe(hooks.descriptor);
    return { offset: 9007199254740993n, errno: 0 };
  });
});
afterEach(() => { expect(hooks.closed).toBe(hooks.opened); });

it("seeks a regular retained reader without deriving the endpoint from file size", async () => {
  const handle = await new RealFileSystem("/machine").openReadFile("/file");
  try {
    expect(hooks.load).not.toHaveBeenCalled();
    expect(await handle.read(0, 3)).toEqual(new TextEncoder().encode("abc"));
    const stats = hooks.stats;
    expect(await handle.seekEnd!()).toBe(9007199254740993n);
    expect(hooks.stats).toBe(stats);
    expect(await handle.read(0, 3)).toEqual(new TextEncoder().encode("abc"));
    expect(hooks.seek).toHaveBeenCalledExactlyOnceWith(hooks.descriptor);
  } finally { await handle.close(); }
});

for (const mode of ["read", "resize"] as const) {
  describe(`Real retained ${mode} native seek`, () => {
    async function acquire(): Promise<FileReadHandle | FileResizeHandle> {
      const filesystem = new RealFileSystem("/machine");
      return mode === "read" ? filesystem.openReadFile("/directory", { allowDirectory: true }) : filesystem.openResizeFile("/file");
    }

    it("acquires lazily and uses the captured descriptor/receiver, never stat size", async () => {
      const handle = await acquire();
      try {
        expect(hooks.load).not.toHaveBeenCalled();
        expect(handle.seekEnd).toBeTypeOf("function");
        const before = await handle.stat();
        expect(before.size).toBe(mode === "read" ? 0 : 3);
        const statCalls = hooks.stats;
        expect(await handle.seekEnd!()).toBe(9007199254740993n);
        expect(hooks.stats).toBe(statCalls);
        expect(hooks.seek).toHaveBeenCalledExactlyOnceWith(hooks.descriptor);
        expect(vol.readFileSync("/machine/file", "utf8")).toBe("abc");
      } finally { await handle.close(); }
    });

    it("keeps seek bound to the acquired inode after pathname replacement", async () => {
      const handle = await acquire();
      try {
        const before = await handle.stat();
        const pathname = mode === "read" ? "/machine/directory" : "/machine/file";
        vol.renameSync(pathname, `${pathname}-old`);
        vol.writeFileSync(pathname, "replacement");
        expect(await handle.seekEnd!()).toBe(9007199254740993n);
        expect(fs.fstatSync(hooks.descriptor).ino).toBe(before.ino);
        expect(vol.statSync(pathname).ino).not.toBe(before.ino);
      } finally { await handle.close(); }
    });

    it.each([false, null, 0, "", NaN])("does not drain opaque binding initialization on cancellation: %s", async reason => {
      const handle = await acquire();
      const initialized = deferred<object>(), entered = deferred();
      const controller = new AbortController();
      hooks.load.mockImplementation(() => { entered.resolve(); return initialized.promise; });
      let outcome: unknown;
      const seeking = handle.seekEnd!({ signal: controller.signal });
      const observed = seeking.then(value => { outcome = { value }; }, error => { outcome = { error }; });
      try {
        await entered.promise;
        controller.abort(reason);
        await handle.close();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(outcome).toEqual({ error: reason });
        expect(hooks.closed).toBe(1);
        expect(hooks.seek).not.toHaveBeenCalled();
      } finally { initialized.resolve(hooks.binding); await observed; await handle.close(); }
      expect(hooks.seek).not.toHaveBeenCalled();
    });

    it("closes during uncanceled metadata and rejects late completion before method lookup", async () => {
      const handle = await acquire();
      const initialized = deferred<object>(), entered = deferred();
      const getter = vi.fn(() => hooks.seek);
      const binding = Object.defineProperty({}, "seekEnd", { get: getter });
      hooks.load.mockImplementation(() => { entered.resolve(); return initialized.promise; });
      const seeking = handle.seekEnd!();
      const observed = seeking.then(value => ({ value }), error => ({ error }));
      try {
        await entered.promise;
        await handle.close();
        expect(hooks.closed).toBe(1);
      } finally { initialized.resolve(binding); await observed; await handle.close(); }
      expect(await observed).toMatchObject({ error: { code: "EBADF", syscall: "lseek" } });
      expect(getter).not.toHaveBeenCalled();
      expect(hooks.seek).not.toHaveBeenCalled();
    });

    it.each(["method", "descriptor"] as const)("guards cancellation caused by the %s getter before dispatch", async phase => {
      const handle = await acquire();
      const controller = new AbortController();
      if (phase === "method") hooks.binding = Object.defineProperty({}, "seekEnd", { get() { controller.abort(false); return hooks.seek; } });
      else hooks.onDescriptor = () => controller.abort(false);
      try { await expect(handle.seekEnd!({ signal: controller.signal })).rejects.toBe(false); }
      finally { await handle.close(); }
      expect(hooks.seek).not.toHaveBeenCalled();
    });

    it("guards reentrant close in the binding method getter before dispatch", async () => {
      const handle = await acquire();
      let closing: Promise<void> | undefined;
      hooks.binding = Object.defineProperty({}, "seekEnd", { get() { closing = handle.close(); return hooks.seek; } });
      try { await expect(handle.seekEnd!()).rejects.toMatchObject({ code: "EBADF", syscall: "lseek" }); }
      finally { await (closing ?? handle.close()); }
      expect(hooks.seek).not.toHaveBeenCalled();
    });

    it.each([false, null, 0, "", NaN])("drains an enrolled native call before physical close after abort: %s", async reason => {
      const handle = await acquire();
      const controller = new AbortController(), entered = deferred(), native = deferred<unknown>();
      hooks.seek.mockImplementation(() => { entered.resolve(); return native.promise; });
      const seeking = handle.seekEnd!({ signal: controller.signal });
      const observed = seeking.then(value => ({ value }), error => ({ error }));
      let closing: Promise<void> | undefined;
      try {
        await entered.promise;
        controller.abort(reason);
        closing = handle.close();
        await Promise.resolve();
        expect(hooks.closed).toBe(0);
        expect(fs.fstatSync(hooks.descriptor)).toBeDefined();
        await expect(handle.seekEnd!()).rejects.toMatchObject({ code: "EBADF" });
      } finally { native.resolve({ offset: 42n, errno: 0 }); await observed; await (closing ?? handle.close()); }
      expect(await observed).toEqual({ error: reason });
      expect(hooks.seek).toHaveBeenCalledOnce();
    });

    it("enrolls before native callback so reentrant close waits for its promise", async () => {
      const handle = await acquire();
      const native = deferred<unknown>(), entered = deferred();
      let closing: Promise<void> | undefined;
      hooks.seek.mockImplementation(() => { closing = handle.close(); entered.resolve(); return native.promise; });
      const seeking = handle.seekEnd!();
      try {
        await entered.promise;
        expect(hooks.closed).toBe(0);
        expect(handle.close()).toBe(closing);
        await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
      } finally { native.resolve({ offset: 7n, errno: 0 }); await seeking; await (closing ?? handle.close()); }
      expect(await seeking).toBe(7n);
    });

    it.each([false, null, 0, "", NaN, undefined])("retires a held native falsey failure independently of a failing close: %s", async reason => {
      const handle = await acquire(), entered = deferred(), native = deferred<unknown>();
      hooks.seek.mockImplementation(() => { entered.resolve(); return native.promise; });
      hooks.failClose = true;
      hooks.closeReason = false;
      const result = handle.seekEnd!().then(value => ({ value }), error => ({ error }));
      let closing: Promise<void> | undefined;
      let cleanup: Promise<unknown> | undefined;
      try {
        await entered.promise;
        closing = handle.close();
        cleanup = closing.then(() => ({ closed: true }), error => ({ error }));
        expect(hooks.closed).toBe(0);
        expect(handle.close()).toBe(closing);
      } finally {
        native.reject(reason);
        await result;
        await (cleanup ?? handle.close().catch(error => ({ error })));
      }
      expect(await result).toEqual({ error: reason });
      expect(await cleanup).toEqual({ error: false });
      expect(hooks.closed).toBe(1);
    });

    it("keeps cancellation primary over a late falsey native rejection", async () => {
      const handle = await acquire(), entered = deferred(), native = deferred<unknown>();
      const controller = new AbortController();
      hooks.seek.mockImplementation(() => { entered.resolve(); return native.promise; });
      const result = handle.seekEnd!({ signal: controller.signal }).then(value => ({ value }), error => ({ error }));
      let closing: Promise<void> | undefined;
      try {
        await entered.promise;
        controller.abort(null);
        closing = handle.close();
        expect(hooks.closed).toBe(0);
      } finally { native.reject(false); await result; await (closing ?? handle.close()); }
      expect(await result).toEqual({ error: null });
    });

    it("captures an operation signal getter once and guards its cancellation", async () => {
      const handle = await acquire(), controller = new AbortController();
      let lookups = 0;
      const options = { get signal() { lookups++; controller.abort(false); return controller.signal; } };
      try { await expect(handle.seekEnd!(options)).rejects.toBe(false); }
      finally { await handle.close(); }
      expect(lookups).toBe(1);
      expect(hooks.load).not.toHaveBeenCalled();
    });

    it("rejects a malformed binding callback before descriptor/native dispatch", async () => {
      const handle = await acquire();
      hooks.binding = { seekEnd: 1 };
      const descriptorLookup = vi.fn();
      hooks.onDescriptor = descriptorLookup;
      try {
        await expect(handle.seekEnd!()).rejects.toMatchObject({ code: "EIO", syscall: "lseek" });
        expect(descriptorLookup).not.toHaveBeenCalled();
        expect(hooks.seek).not.toHaveBeenCalled();
      } finally { hooks.onDescriptor = undefined; await handle.close(); }
    });

    for (const phase of ["load", "native"] as const) {
      it.each([false, null, 0, "", NaN, undefined])(`preserves falsey ${phase} failure: %s`, async reason => {
        const handle = await acquire();
        if (phase === "load") hooks.load.mockRejectedValue(reason);
        else hooks.seek.mockRejectedValue(reason);
        try { await expect(handle.seekEnd!()).rejects.toBe(reason); }
        finally { await handle.close(); }
      });
    }

    it("observes a late opaque rejection after abort without native dispatch", async () => {
      const handle = await acquire(), entered = deferred(), initialized = deferred<object>();
      const controller = new AbortController();
      hooks.load.mockImplementation(() => { entered.resolve(); return initialized.promise; });
      const observed = handle.seekEnd!({ signal: controller.signal }).then(value => ({ value }), error => ({ error }));
      try {
        await entered.promise;
        controller.abort(false);
        await handle.close();
        expect(await observed).toEqual({ error: false });
      } finally { initialized.reject(null); await observed; await handle.close(); }
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(hooks.seek).not.toHaveBeenCalled();
    });

    it.each([[9, "EBADF"], [22, "EINVAL"], [29, "ESPIPE"]] as const)("maps native errno %s to sanitized %s", async (errno, code) => {
      const handle = await acquire();
      hooks.seek.mockResolvedValue({ offset: -1n, errno });
      try {
        const error = await handle.seekEnd!().catch(error => error);
        expect(error).toMatchObject({ code, syscall: "lseek", path: mode === "read" ? "/directory" : "/file" });
        expect(error.cause).toBeUndefined();
        expect(error.message).not.toContain("/machine");
      } finally { await handle.close(); }
    });

    it("rejects pre-aborted and closed admission without initializing the binding", async () => {
      const handle = await acquire(), controller = new AbortController();
      controller.abort(false);
      try { await expect(handle.seekEnd!({ signal: controller.signal })).rejects.toBe(false); }
      finally { await handle.close(); }
      await expect(handle.seekEnd!()).rejects.toMatchObject({ code: "EBADF" });
      await expect(handle.seekEnd!({ signal: controller.signal })).rejects.toBe(false);
      expect(hooks.load).not.toHaveBeenCalled();
    });
  });
}
