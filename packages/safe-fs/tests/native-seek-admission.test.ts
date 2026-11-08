import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeSeekBinding } from "../src/native/loader.js";

const hooks = vi.hoisted(() => ({ load: vi.fn(), imported: vi.fn(), onLookup: undefined as (() => void) | undefined }));
vi.mock("node:module", () => ({ createRequire: () => { throw new Error("Actual addon loading is forbidden in unit tests"); } }));

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hooks.onLookup = undefined;
  hooks.load.mockResolvedValue({ seekEnd: vi.fn(async () => ({ offset: 0n, errno: 0 })) });
  vi.doMock("../dist/native/fs-seek/loader.mjs", () => {
    hooks.imported();
    return Object.defineProperty({}, "loadBinding", { enumerable: true, get() { hooks.onLookup?.(); return hooks.load; } });
  });
});

describe("private native seek admission", () => {
  it("does not import the private loader on ordinary helper import", async () => {
    await import("../src/node/native-seek.js");
    expect(hooks.imported).not.toHaveBeenCalled();
    expect(hooks.load).not.toHaveBeenCalled();
  });

  it.each([false, null, 0, "", NaN])("does not initialize after pre-abort: %s", async reason => {
    const { loadNativeSeekBinding } = await import("../src/node/native-seek.js");
    const controller = new AbortController();
    controller.abort(reason);
    await expect(loadNativeSeekBinding(controller.signal)).rejects.toBe(reason);
    expect(hooks.imported).not.toHaveBeenCalled();
    expect(hooks.load).not.toHaveBeenCalled();
  });

  it("guards cancellation in the private loader export lookup", async () => {
    const { loadNativeSeekBinding } = await import("../src/node/native-seek.js");
    const controller = new AbortController();
    hooks.onLookup = () => controller.abort(false);
    await expect(loadNativeSeekBinding(controller.signal)).rejects.toBe(false);
    expect(hooks.load).not.toHaveBeenCalled();
  });

  it("preserves the loader receiver and the binding identity", async () => {
    const { loadNativeSeekBinding } = await import("../src/node/native-seek.js");
    const binding = { seekEnd: vi.fn(async () => ({ offset: 1n, errno: 0 })) };
    hooks.load.mockImplementation(async function (this: { loadBinding: unknown }) {
      expect(this.loadBinding).toBe(hooks.load);
      return binding;
    });
    expect(await loadNativeSeekBinding()).toBe(binding);
  });

  it.each(["resolve", "reject"] as const)("observes a late module %s without invoking its loader after abort", async settlement => {
    const module = deferred<object>(), entered = deferred();
    vi.doMock("../dist/native/fs-seek/loader.mjs", async () => { entered.resolve(); return module.promise; });
    const { loadNativeSeekBinding } = await import("../src/node/native-seek.js");
    const controller = new AbortController();
    const initialized = loadNativeSeekBinding(controller.signal).then(value => ({ value }), error => ({ error }));
    try {
      await entered.promise;
      controller.abort(false);
      expect(await initialized).toEqual({ error: false });
    } finally {
      if (settlement === "resolve") module.resolve({ loadBinding: hooks.load });
      else module.reject(null);
      await initialized;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(hooks.load).not.toHaveBeenCalled();
  });

  it.each([false, null, 0, "", NaN, undefined])("retains falsey load failure: %s", async reason => {
    const { loadNativeSeekBinding } = await import("../src/node/native-seek.js");
    hooks.load.mockRejectedValue(reason);
    await expect(loadNativeSeekBinding()).rejects.toBe(reason);
  });

  it.each([false, null, 0, "", NaN])("races held binding metadata while keeping rejection observers: %s", async reason => {
    const initialized = deferred<object>(), entered = deferred();
    hooks.load.mockImplementation(() => { entered.resolve(); return initialized.promise; });
    const { loadNativeSeekBinding } = await import("../src/node/native-seek.js");
    const controller = new AbortController();
    const outcome = loadNativeSeekBinding(controller.signal).then(value => ({ value }), error => ({ error }));
    try {
      await entered.promise;
      controller.abort(reason);
      expect(await outcome).toEqual({ error: reason });
    } finally { initialized.reject(null); await outcome; }
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  it.each([0n, 9007199254740993n, 9223372036854775807n])("returns exact native offset %s with the captured callback and receiver", async offset => {
    const { callNativeSeekEnd } = await import("../src/node/native-seek.js");
    const binding = { seekEnd: vi.fn(async function (this: unknown, descriptor: number) { expect(this).toBe(binding); expect(descriptor).toBe(123); return { offset, errno: 0 }; }) };
    const callback = binding.seekEnd;
    binding.seekEnd = vi.fn(async () => { throw new Error("must not re-read the method"); });
    expect(await callNativeSeekEnd(binding, callback, 123)).toBe(offset);
    expect(callback).toHaveBeenCalledExactlyOnceWith(123);
    expect(binding.seekEnd).not.toHaveBeenCalled();
  });

  it.each([[9, "EBADF"], [22, "EINVAL"], [29, "ESPIPE"], [13, "EACCES"]] as const)("maps actual POSIX errno %s using the public Node map", async (errno, code) => {
    const { callNativeSeekEnd } = await import("../src/node/native-seek.js");
    const binding = { seekEnd: vi.fn(async () => ({ offset: -1n, errno })) };
    await expect(callNativeSeekEnd(binding, binding.seekEnd, 123)).rejects.toMatchObject({ code });
  });

  it.each([
    null, undefined, false, {}, [], { offset: 0, errno: 0 }, { offset: -1n, errno: 0 },
    { offset: 9223372036854775808n, errno: 0 }, { offset: 1n, errno: 9 },
    { offset: -1n, errno: -9 }, { offset: -1n, errno: 1.5 }, { offset: -1n, errno: NaN },
    { offset: -1n, errno: Infinity }, { offset: 0n, errno: "0" }, { offset: 0n, errno: false },
    { offset: -1n, errno: 2147483648 }, { offset: -1n, errno: 99999 },
  ])("rejects invalid native result %s", async result => {
    const { callNativeSeekEnd } = await import("../src/node/native-seek.js");
    const binding = { seekEnd: vi.fn(async () => result) } as unknown as NativeSeekBinding;
    await expect(callNativeSeekEnd(binding, binding.seekEnd, 123)).rejects.toMatchObject({ code: "EIO" });
  });

  it.each([false, null, 0, "", NaN, undefined])("preserves native promise rejection identity: %s", async reason => {
    const { callNativeSeekEnd } = await import("../src/node/native-seek.js");
    const binding = { seekEnd: vi.fn(async () => { throw reason; }) };
    await expect(callNativeSeekEnd(binding, binding.seekEnd, 123)).rejects.toBe(reason);
  });
});
