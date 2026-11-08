import { describe, expect, it, vi } from "vitest";
import {
  Buffer as BrowserBuffer,
  clearImmediate,
  setImmediate,
  setTimeout as browserSetTimeout,
  clearTimeout as browserClearTimeout
} from "./platform.js";
import { basename, dirname, extname, joinPath } from "./path.js";
import { isAscii, isUtf8, types } from "./browser-builtins.mjs";
import { setImmediate as pause } from "./browser-timer-promises.mjs";
import { createHash as nativeHash } from "node:crypto";
import { Buffer as NativeBuffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import { createHash, randomBytes, randomInt, randomUUID } from "./browser-crypto.mjs";

vi.mock("@jspm/core/nodelibs/buffer", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const require = createRequire(import.meta.url);
  const source = new URL("../browser/buffer.js", pathToFileURL(require.resolve("@jspm/core/nodelibs/buffer")));
  return import(/* @vite-ignore */ source.href);
});

describe("browser byte platform", () => {
  it("matches all checksum algorithms with incremental binary and encoded inputs", () => {
    const bytes = Uint8Array.from({ length: 65537 }, (_, index) => index % 251);
    for (const algorithm of ["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]) {
      const expected = nativeHash(algorithm).update(bytes).update("é").digest("hex");
      const actual = createHash(algorithm.toUpperCase());
      expect(actual.update(bytes.subarray(0, 32768))).toBe(actual);
      actual.update(bytes.subarray(32768)).update("c3a9", "hex");
      expect(actual.digest("hex")).toBe(expected);
      expect(createHash(algorithm).digest().toString("hex")).toBe(nativeHash(algorithm).digest("hex"));
      expect(() => actual.update("later")).toThrow();
      expect(() => actual.digest()).toThrow();
    }
    expect(() => createHash("not-a-hash")).toThrow();
  });

  it("generates bounded random bytes and version-four UUIDs", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(90));
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      const bytes = randomBytes(65537);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(65537);
      expect(bytes.every((byte: number) => byte === 90)).toBe(true);
      expect(bytes.subarray(0, 16).toString("hex")).toBe("5a".repeat(16));
      expect(getRandomValues.mock.calls.map(([chunk]) => chunk.length)).toEqual([65536, 1]);
      expect(randomBytes(0).length).toBe(0);
      for (const length of [-1, 0.5, NaN, Infinity]) expect(() => randomBytes(length)).toThrow();
      expect(getRandomValues).toHaveBeenCalledTimes(2);
      const uuid = randomUUID();
      expect(uuid.split("-").map((part: string) => part.length)).toEqual([8, 4, 4, 4, 12]);
      expect(uuid[14]).toBe("4");
      expect("89ab".includes(uuid[19])).toBe(true);
      expect(getRandomValues).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("validates byte encodings and rejects non-cloneable transport values", () => {
    expect(isUtf8(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]))).toBe(true);
    expect(isUtf8(new Uint8Array([0xc0, 0xaf]))).toBe(false);
    expect(isAscii(new Uint8Array([0, 127]))).toBe(true);
    expect(isAscii(new Uint8Array([128]))).toBe(false);
    expect(types.isProxy(new Proxy({}, {}))).toBe(true);
    expect(types.isProxy({ bytes: new Uint8Array([1]) })).toBe(false);
  });

  it("honors cancellation of cooperative timer promises", async () => {
    const controller = new AbortController();
    const paused = pause("done", { signal: controller.signal });
    controller.abort(new Error("cancelled pause"));
    await expect(paused).rejects.toThrow("cancelled pause");
    await expect(pause(undefined, { signal: controller.signal })).rejects.toThrow(
      "cancelled pause"
    );
    await expect(pause("done")).resolves.toBe("done");
  });

  it("bounds cryptographic random integer requests", () => {
    expect(randomInt(7, 8)).toBe(7);
    expect(randomInt(1)).toBe(0);
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(0, 2 ** 32 + 1)).toThrow(RangeError);
  });
  it("provides cancellable timer handles with the worker pool's ref methods", () => {
    const timer = browserSetTimeout(() => {
      throw new Error("Timer was not cancelled");
    }, 10);
    expect(timer.unref()).toBe(timer);
    expect(timer.ref()).toBe(timer);
    browserClearTimeout(timer);
  });
  it("supports the buffer operations used by the full command bundle", () => {
    const bytes = BrowserBuffer.alloc(4);
    bytes.writeUInt32LE(513);
    expect(bytes.readUInt32LE()).toBe(513);
    expect(BrowserBuffer.concat([bytes, BrowserBuffer.from("!")]).length).toBe(5);
    expect(BrowserBuffer.from("aGVsbG8=", "base64").toString()).toBe("hello");
  });
  it("preserves UTF-8 lengths, BOMs, and binary latin1", () => {
    expect(BrowserBuffer.byteLength("😀é")).toBe(6);
    expect(BrowserBuffer.from("\ufeffhello").toString()).toBe("\ufeffhello");
    expect(BrowserBuffer.from([0, 128, 255]).toString("latin1")).toBe("\0\u0080ÿ");
    expect(() => BrowserBuffer.from("hello").toString("unknown")).toThrow();
  });

  it("copies array inputs and shares explicitly selected arraybuffer views", () => {
    const original = new Uint8Array([3, 4, 5]);
    const copied = BrowserBuffer.from(original);
    const viewed = BrowserBuffer.from(original.buffer, 1, 2);
    original[1] = 9;
    expect([...copied]).toEqual([3, 4, 5]);
    expect([...viewed]).toEqual([9, 5]);
    expect(BrowserBuffer.compare(copied, original)).toBe(-1);
    expect(BrowserBuffer.compare(copied, copied)).toBe(0);
    expect(BrowserBuffer.from("abc").subarray(1).toString()).toBe("bc");
  });

  it("finds byte-sequence delimiters without decoding binary input", () => {
    const bytes = BrowserBuffer.from([255, 1, 2, 1, 2]);
    expect(bytes.indexOf(new Uint8Array([1, 2]))).toBe(1);
    expect(bytes.indexOf(new Uint8Array([1, 2]), 2)).toBe(3);
    expect(bytes.indexOf(new Uint8Array([2, 2]))).toBe(-1);
    expect(bytes.indexOf(255)).toBe(0);
  });

  it("copies into Uint8Array views with native byte ranges and overlap behavior", () => {
    for (const [targetStart, sourceStart, sourceEnd] of [[0, 0, 4], [1, 1, 4], [3, 0, 4], [0, 2, 2], [4, 0, 4]]) {
      const actual = new Uint8Array([0, 1, 128, 255, 4, 5]);
      const expected = actual.slice();
      const copied = BrowserBuffer.prototype.copy.call(actual.subarray(0, 4), actual.subarray(1, 5), targetStart, sourceStart, sourceEnd);
      const nativeCopied = NativeBuffer.prototype.copy.call(expected.subarray(0, 4), expected.subarray(1, 5), targetStart, sourceStart, sourceEnd);
      expect(copied).toBe(nativeCopied);
      expect(actual).toEqual(expected);
    }
    const destination = new Uint8Array(5);
    expect(BrowserBuffer.from([1, 128, 255]).copy(destination.subarray(1, 4))).toBe(3);
    expect([...destination]).toEqual([0, 1, 128, 255, 0]);
  });

  it("matches native raw-byte copies into typed and cross-realm views", () => {
    for (const View of [Uint8Array, Uint8ClampedArray, Uint16Array, DataView]) {
      for (const createTarget of [
        () => new View(new ArrayBuffer(8), 2),
        () => runInNewContext(`new ${View.name}(new ArrayBuffer(8), 2)`) as ArrayBufferView,
      ]) {
        const actual = createTarget(), expected = createTarget();
        new Uint8Array(actual.buffer).fill(17);
        new Uint8Array(expected.buffer).fill(17);
        const copied = BrowserBuffer.from([1, 128, 255]).copy(actual, 1);
        const nativeCopied = Reflect.apply(NativeBuffer.prototype.copy, NativeBuffer.from([1, 128, 255]), [expected, 1]);
        expect(copied).toBe(nativeCopied);
        expect(new Uint8Array(actual.buffer)).toEqual(new Uint8Array(expected.buffer));
      }
    }
  });

  it("retains native copy errors for invalid targets and negative byte ranges", () => {
    const bytes = BrowserBuffer.from([1, 2, 3]);
    for (const [targetStart, sourceStart, sourceEnd] of [[-1, 0, 1], [0, -1, 1], [0, 0, -1]]) {
      const target = new Uint8Array(3);
      expect(() => bytes.copy(target, targetStart, sourceStart, sourceEnd)).toThrow(RangeError);
      expect(() => NativeBuffer.from(bytes).copy(target, targetStart, sourceStart, sourceEnd)).toThrow(RangeError);
    }
    for (const target of [[], {}, new ArrayBuffer(3), null, undefined]) {
      expect(() => bytes.copy(target)).toThrow(TypeError);
      expect(() => Reflect.apply(NativeBuffer.prototype.copy, NativeBuffer.from(bytes), [target])).toThrow(TypeError);
    }
  });

  it("yields to timers and cancels pending immediate callbacks", async () => {
    const events: string[] = [];
    const cancelled = setImmediate(() => events.push("cancelled"));
    clearImmediate(cancelled);
    setTimeout(() => events.push("timer"), 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(["timer"]);
  });
});

describe("browser POSIX path helpers", () => {
  it.each([
    ["/home/a.txt", "a.txt", "/home", ".txt"],
    ["/home/", "home", "/", ""],
    ["/", "", "/", ""],
    ["..", "..", ".", ""],
    [".profile", ".profile", ".", ""],
    ["file.", "file.", ".", "."]
  ])("handles %s", (path, base, parent, extension) => {
    expect(basename(path)).toBe(base);
    expect(dirname(path)).toBe(parent);
    expect(extname(path)).toBe(extension);
  });

  it("joins paths without treating later absolute segments as a reset", () => {
    expect(joinPath("/home", "/docs", "../file")).toBe("/home/file");
    expect(joinPath("a", "../../b/")).toBe("../b/");
    expect(joinPath()).toBe(".");
  });
});
