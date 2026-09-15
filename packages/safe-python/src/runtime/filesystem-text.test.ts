import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { FileSystemAccess } from "./filesystem-access.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";

function text(value: string): CodePointString {
  return new CodePointString(Uint32Array.from(value, point => point.codePointAt(0)!));
}

describe("whole-file UTF-8 filesystem integration", () => {
  it.each([null, "", "\n", "\r", "\r\n"])("decodes newline mode %j", async newline => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/text", new TextEncoder().encode("α\r\nβ\rγ\n"));
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100);
    expect([...await access.readText("/text", { newline })]).toEqual([...text(newline === null ? "α\nβ\nγ\n" : "α\r\nβ\rγ\n")]);
  });

  it("flushes malformed final UTF-8 and supports explicit recovery", async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/text", new Uint8Array([13, 0xe2]));
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100);
    await expect(access.readText("/text")).rejects.toMatchObject({ name: "UnicodeDecodeError", start: 1, end: 2 });
    expect([...await access.readText("/text", { errors: "replace" })]).toEqual([10, 0xfffd]);
  });

  it("encodes, exclusively creates, appends, and overwrites text with character counts", async () => {
    const fs = createMemoryFileSystem();
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100);
    expect(await access.writeText("/text", text("😀\n"), { mode: "x", newline: "\r\n" })).toBe(2n);
    await expect(access.writeText("/text", text("x"), { mode: "x" })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await access.writeText("/text", text("β"), { mode: "a" })).toBe(1n);
    expect([...await access.readText("/text", { newline: "" })]).toEqual([...text("😀\r\nβ")]);
    await access.writeText("/text", text("z"));
    expect([...await fs.readFile("/text")]).toEqual([122]);
  });

  it("prepares encoding before handing bytes to the filesystem", async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/text", new Uint8Array([1]));
    const write = vi.spyOn(fs, "writeFile");
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100);
    await expect(access.writeText("/text", text("\n\ud800"), { newline: "\r\n" })).rejects.toMatchObject({ name: "UnicodeEncodeError", start: 2 });
    expect(write).not.toHaveBeenCalled();
    expect([...await fs.readFile("/text")]).toEqual([1]);
  });

  it("validates read newline configuration before accessing the adapter", async () => {
    const fs = createMemoryFileSystem(), read = vi.spyOn(fs, "readFile");
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100);
    await expect(access.readText("/text", { newline: "invalid" })).rejects.toMatchObject({ name: "ValueError" });
    expect(read).not.toHaveBeenCalled();
  });

  it("charges decoding buffers against the same filesystem budget", async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/text", new Uint8Array([97, 98]));
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 4 }), 2);
    await expect(access.readText("/text")).rejects.toMatchObject({ reason: "allocation" });
  });

  it("rejects cancelled text operations before encoding or I/O", async () => {
    const fs = createMemoryFileSystem(), controller = new AbortController();
    controller.abort();
    const access = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100, controller.signal);
    await expect(access.readText("/text")).rejects.toMatchObject({ reason: "cancelled" });
    await expect(access.writeText("/text", text("\ud800"))).rejects.toMatchObject({ reason: "cancelled" });
  });

  it("checks cancellation again after awaiting the binary write boundary", async () => {
    const controller = new AbortController();
    const access = new FileSystemAccess(createMemoryFileSystem(), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), 100, controller.signal);
    vi.spyOn(access, "writeFile").mockImplementation(async () => { controller.abort(); });
    await expect(access.writeText("/text", text("abc"))).rejects.toMatchObject({ reason: "cancelled" });
  });
});
