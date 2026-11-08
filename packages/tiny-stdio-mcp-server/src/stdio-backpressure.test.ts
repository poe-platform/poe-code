import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./server.js";
import type { ServerOptions } from "./types.js";

const parseError = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n";

function heldOutput(options: Partial<ServerOptions> = {}) {
  const readable = new PassThrough();
  const callbacks: Array<(error?: Error | null) => void> = [];
  const frames: string[] = [];
  const writable = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      frames.push(chunk.toString());
      callbacks.push(callback);
    }
  });
  const write = vi.spyOn(writable, "write");
  const server = createServer({ name: "backpressure", version: "1", ...options });
  let outcome: { status: "resolved" } | { status: "rejected"; error: unknown } | undefined;
  const connected = server.connect({ readable, writable }).then(
    () => { outcome = { status: "resolved" }; },
    error => { outcome = { status: "rejected", error }; }
  );
  return {
    server, readable, writable, frames, write, connected,
    outcome: () => outcome,
    release() { callbacks.shift()?.(); },
    async cleanup() {
      readable.end();
      for (let turn = 0; turn < 8; turn++) {
        while (callbacks.length > 0) callbacks.shift()!();
        await setImmediate();
      }
      readable.destroy();
      writable.destroy();
      await connected;
      write.mockRestore();
    }
  };
}

describe("stdio output admission", () => {
  it("does not submit a second frame before drain or finish connect before output settles", async () => {
    const fixture = heldOutput();
    try {
      fixture.readable.end("{\n{\n");
      await setImmediate();
      expect(fixture.frames).toEqual([parseError]);
      expect(fixture.writable.writableNeedDrain).toBe(true);
      expect(fixture.write).toHaveBeenCalledTimes(1);
      expect(fixture.writable.writableLength).toBe(Buffer.byteLength(parseError));
      expect(fixture.outcome()).toBeUndefined();
      fixture.release();
      await setImmediate();
      expect(fixture.write).toHaveBeenCalledTimes(2);
      expect(fixture.frames).toEqual([parseError, parseError]);
      expect(fixture.outcome()).toBeUndefined();
      fixture.release();
      await fixture.connected;
      expect(fixture.outcome()).toEqual({ status: "resolved" });
    } finally { await fixture.cleanup(); }
  });

  it("counts submitted and queued bytes together before accepting another frame", async () => {
    const options = { maxStdioOutputBytes: 2 * Buffer.byteLength(parseError) - 1 };
    const fixture = heldOutput(options);
    try {
      fixture.readable.end("{\n{\n");
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected", error: { message: "Stdio output byte limit exceeded" } });
      expect(fixture.write).toHaveBeenCalledTimes(1);
      expect(fixture.writable.destroyed).toBe(false);
    } finally { await fixture.cleanup(); }
  });

  it("holds message admission until its output settles without an overload response", async () => {
    const options = { maxPendingStdioMessages: 2 };
    const fixture = heldOutput(options);
    try {
      fixture.readable.end("{\n{\n{\n");
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected", error: { message: "Stdio pending message limit exceeded" } });
      expect(fixture.write).toHaveBeenCalledTimes(1);
    } finally { await fixture.cleanup(); }
  });

  it("rejects an individually oversized frame before calling write", async () => {
    const options = { maxStdioOutputBytes: Buffer.byteLength(parseError) - 1 };
    const fixture = heldOutput(options);
    try {
      fixture.readable.end("{\n");
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected", error: { message: "Stdio output byte limit exceeded" } });
      expect(fixture.write).not.toHaveBeenCalled();
    } finally { await fixture.cleanup(); }
  });

  it("admits an exact-byte-boundary frame without truncation", async () => {
    const options = { maxStdioOutputBytes: Buffer.byteLength(parseError) };
    const fixture = heldOutput(options);
    try {
      fixture.readable.end("{\n");
      await setImmediate();
      expect(fixture.frames).toEqual([parseError]);
      fixture.release();
      await fixture.connected;
      expect(fixture.outcome()).toEqual({ status: "resolved" });
    } finally { await fixture.cleanup(); }
  });

  it("validates both positive safe-integer capacities", () => {
    for (const name of ["maxStdioOutputBytes", "maxPendingStdioMessages"] as const) {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => createServer({ name: "invalid", version: "1", [name]: value })).toThrow(
          `${name} must be a safe integer greater than or equal to 1.`
        );
      }
    }
  });

  for (const side of ["readable", "writable"] as const) {
    it(`rejects connect on ${side} errors while output is blocked`, async () => {
      const fixture = heldOutput();
      const error = new Error(`controlled ${side} failure`);
      try {
        fixture.readable.write("{\n");
        await setImmediate();
        expect(fixture.outcome()).toBeUndefined();
        fixture[side].destroy(error);
        await setImmediate();
        expect(fixture.outcome()).toEqual({ status: "rejected", error });
      } finally { await fixture.cleanup(); }
    });
  }

  it("shares response and notification ordering and waits for both at EOF", async () => {
    const fixture = heldOutput();
    try {
      fixture.readable.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }) + "\n");
      await setImmediate();
      fixture.release();
      await setImmediate();
      fixture.readable.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      await setImmediate();
      const first = fixture.server.notifyToolsChanged();
      fixture.readable.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
      await setImmediate();
      const last = fixture.server.notifyPromptsChanged();
      fixture.readable.end();
      await setImmediate();
      expect(fixture.write).toHaveBeenCalledTimes(2);
      fixture.release();
      await setImmediate();
      expect(JSON.parse(fixture.frames[2]!)).toMatchObject({ id: 1, result: {} });
      fixture.release();
      await setImmediate();
      expect(JSON.parse(fixture.frames[3]!)).toMatchObject({ method: "notifications/prompts/list_changed" });
      expect(fixture.outcome()).toBeUndefined();
      fixture.release();
      await Promise.all([first, last, fixture.connected]);
      expect(fixture.outcome()).toEqual({ status: "resolved" });
    } finally { await fixture.cleanup(); }
  });

  it("aborts the session and rejects overflow without waiting for an active host handler", async () => {
    const fixture = heldOutput({ maxPendingStdioMessages: 2 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let signal: AbortSignal | undefined;
    fixture.server.method("held", async (_params, context) => { signal = context.signal; await gate; return {}; });
    try {
      fixture.readable.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }) + "\n");
      await setImmediate();
      fixture.release();
      await setImmediate();
      fixture.readable.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "held" }) + "\n");
      await setImmediate();
      expect(signal?.aborted).toBe(false);
      fixture.readable.write("{\n{\n");
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected", error: { message: "Stdio pending message limit exceeded" } });
      expect(signal?.aborted).toBe(true);
      expect(fixture.writable.destroyed).toBe(false);
    } finally { release(); await fixture.cleanup(); }
  });

  it("keeps concurrent host handlers and ping responsive", async () => {
    const server = createServer({ name: "concurrency", version: "1" });
    const readable = new PassThrough();
    const writable = new PassThrough();
    let text = "";
    writable.on("data", chunk => { text += chunk.toString(); });
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.method("held", async () => { started++; await gate; return {}; });
    const connected = server.connect({ readable, writable });
    try {
      readable.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }) + "\n");
      await setImmediate();
      for (const [id, method] of [[1, "held"], [2, "held"], [3, "ping"]]) {
        readable.write(JSON.stringify({ jsonrpc: "2.0", id, method }) + "\n");
      }
      await setImmediate();
      expect(started).toBe(2);
      expect(text.trim().split("\n").map(line => JSON.parse(line).id)).toEqual([0, 3]);
      release();
      readable.end();
      await connected;
      expect(text.trim().split("\n").map(line => JSON.parse(line).id)).toEqual([0, 3, 1, 2]);
    } finally { release(); readable.end(); await connected; writable.destroy(); }
  });
});
