import { describe, expect, it } from "vitest";
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
import { randomInt } from "./browser-crypto.mjs";

describe("browser byte platform", () => {
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
