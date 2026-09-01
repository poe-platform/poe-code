import { describe, expect, it } from "vitest";
import { Buffer as BrowserBuffer, clearImmediate, setImmediate } from "./platform.js";
import { basename, dirname, extname, joinPath } from "./path.js";

describe("browser byte platform", () => {
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
