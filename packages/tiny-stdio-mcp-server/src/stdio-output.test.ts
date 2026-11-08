import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { StdioOutput } from "./stdio-output.js";

describe("stdio writer failure settlement", () => {
  it("writes the charged UTF-8 bytes without changing the caller's default encoding", async () => {
    const chunks: Buffer[] = [];
    const writable = new Writable({ defaultEncoding: "utf16le", write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    const output = new StdioOutput(writable, 2, () => {}, () => {});
    try {
      await output.write("a\n");
      expect(chunks[0]).toEqual(Buffer.from("a\n", "utf8"));
      output.close();
      await new Promise<void>((resolve, reject) => {
        writable.write("b\n", error => { if (error) reject(error); else resolve(); });
      });
      expect(chunks[1]).toEqual(Buffer.from("b\n", "utf16le"));
    } finally { output.close(); writable.destroy(); }
  });

  it("releases a completed owned write on abort while a caller write still awaits drain", async () => {
    const callbacks: Array<(error?: Error | null) => void> = [];
    const writable = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { callbacks.push(callback); } });
    const callerErrors: unknown[] = [];
    const callerListener = (error: unknown) => { callerErrors.push(error); };
    writable.on("error", callerListener);
    const output = new StdioOutput(writable, 8, () => {}, () => {});
    const first = output.write("a").catch(error => error);
    writable.write("b");
    try {
      callbacks.shift()!();
      await setImmediate();
      expect(writable.writableNeedDrain).toBe(true);
      const primary = new Error("connection stopped");
      output.abort(primary);
      expect(await first).toBe(primary);
      callbacks.shift()!();
      await setImmediate();
      expect(writable.writableNeedDrain).toBe(false);
      expect(writable.listeners("error")).toEqual([callerListener]);
      expect(writable.listenerCount("drain")).toBe(0);
      expect(writable.listenerCount("close")).toBe(0);
      expect(callerErrors).toEqual([]);
    } finally { while (callbacks.length > 0) callbacks.shift()!(); writable.destroy(); }
  });

  it("preserves a falsey synchronous write failure and rejects later writes with it", async () => {
    const writable = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const write = vi.spyOn(writable, "write").mockImplementation(() => { throw 0; });
    const failures: unknown[] = [];
    const output = new StdioOutput(writable, 16, error => { failures.push(error); }, () => {});
    try {
      await expect(output.write("first")).rejects.toBe(0);
      await expect(output.write("next")).rejects.toBe(0);
      expect(failures).toEqual([0]);
      expect(write).toHaveBeenCalledTimes(1);
      expect(writable.listenerCount("error")).toBe(0);
    } finally { write.mockRestore(); writable.destroy(); }
  });

  it("charges UTF-8 bytes and the frame newline before submitting", async () => {
    const chunks: string[] = [];
    const failures: unknown[] = [];
    const writable = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callback(); } });
    const output = new StdioOutput(writable, 3, error => { failures.push(error); }, () => {});
    await output.write("é\n");
    expect(chunks).toEqual(["é\n"]);
    await expect(output.write("éé\n")).rejects.toThrow("Stdio output byte limit exceeded");
    expect(chunks).toHaveLength(1);
    expect(failures).toHaveLength(1);
    writable.destroy();
  });

  it("observes a late callback error after overflow without replacing the primary failure", async () => {
    let release!: (error: Error) => void;
    const failures: unknown[] = [];
    const writable = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { release = callback; } });
    const output = new StdioOutput(writable, 1, error => { failures.push(error); }, () => {});
    const first = output.write("a").catch(error => error);
    const second = output.write("b").catch(error => error);
    expect(await first).toBe(await second);
    release(new Error("late write failure"));
    await setImmediate();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ message: "Stdio output byte limit exceeded" });
    expect(writable.listenerCount("error")).toBe(0);
    writable.destroy();
  });

  for (const cause of ["error", "close"] as const) {
    it(`rejects both submitted and queued frames on writable ${cause}`, async () => {
      let release: (() => void) | undefined;
      const writable = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { release = callback; } });
      const failures: unknown[] = [];
      const outcomes: unknown[] = [];
      const output = new StdioOutput(writable, 16, error => { failures.push(error); }, () => {});
      const failure = new Error("controlled output failure");
      const first = output.write("first").catch(error => { outcomes.push(error); });
      const second = output.write("next").catch(error => { outcomes.push(error); });
      try {
        writable.destroy(cause === "error" ? failure : undefined);
        await setImmediate();
        expect(failures).toHaveLength(1);
        expect(outcomes).toHaveLength(2);
        expect(outcomes[0]).toBe(failures[0]);
        expect(outcomes[1]).toBe(failures[0]);
        if (cause === "error") expect(failures[0]).toBe(failure);
        expect(writable.listenerCount("error")).toBe(0);
        expect(writable.listenerCount("drain")).toBe(0);
        await Promise.all([first, second]);
      } finally { release?.(); writable.destroy(); }
    });
  }
});
