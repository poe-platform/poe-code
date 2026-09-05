import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createServer } from "./server.js";

function connectedFixture(maxStdioLineBytes?: number, objectMode = false) {
  const readable = new PassThrough({ objectMode });
  const frames: string[] = [];
  const writable = new Writable({ write(chunk, _encoding, callback) { frames.push(chunk.toString()); callback(); } });
  const options = { name: "input-limit", version: "1", ...(maxStdioLineBytes === undefined ? {} : { maxStdioLineBytes }) };
  const server = createServer(options);
  let outcome: { status: string; error?: unknown } | undefined;
  const connected = server.connect({ readable, writable }).then(
    () => { outcome = { status: "resolved" }; },
    error => { outcome = { status: "rejected", error }; }
  );
  return {
    readable, frames, connected, outcome: () => outcome,
    async cleanup() { readable.end(); await connected; readable.destroy(); writable.destroy(); }
  };
}

describe("stdio input line admission", () => {
  it("bounds an unterminated line with the default one-MiB capacity", async () => {
    const fixture = connectedFixture();
    try {
      fixture.readable.write(Buffer.alloc(1024 * 1024 + 1, 120));
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected", error: { message: "Stdio input line byte limit exceeded" } });
      expect(fixture.frames).toEqual([]);
    } finally { await fixture.cleanup(); }
  });

  for (const reason of [false, null]) {
    it(`preserves a falsey input error while a line is incomplete: ${String(reason)}`, async () => {
      const fixture = connectedFixture(16);
      try {
        fixture.readable.write(Buffer.from([0xf0, 0x9f]));
        fixture.readable.emit("error", reason);
        await fixture.connected;
        expect(fixture.outcome()).toEqual({ status: "rejected", error: reason });
        expect(fixture.frames).toEqual([]);
      } finally { await fixture.cleanup(); }
    });
  }

  for (const capacity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects invalid capacity ${capacity}`, () => {
      const options = { name: "input-limit", version: "1", maxStdioLineBytes: capacity };
      expect(() => createServer(options)).toThrow("maxStdioLineBytes must be a safe integer greater than or equal to 1.");
    });
  }

  for (const objectMode of [false, true]) {
    for (const fragmented of [false, true]) {
      it(`rejects before a terminator: strings=${objectMode}, fragmented=${fragmented}`, async () => {
        const fixture = connectedFixture(16, objectMode);
        try {
          const chunks = fragmented ? ["x".repeat(8), "x".repeat(8), "x"] : ["x".repeat(17)];
          for (const chunk of chunks) fixture.readable.write(objectMode ? chunk : Buffer.from(chunk));
          await setImmediate();
          expect(fixture.outcome()).toMatchObject({ status: "rejected", error: { message: "Stdio input line byte limit exceeded" } });
          expect(fixture.frames).toEqual([]);
          expect(fixture.readable.isPaused()).toBe(true);
          expect(fixture.readable.listenerCount("data")).toBe(0);
        } finally { await fixture.cleanup(); }
      });
    }
  }

  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { text: "é🚀" } });
  for (const ending of ["\n", "\r", "\r\n", ""]) {
    it(`admits exactly bounded UTF-8 with ending ${JSON.stringify(ending)}`, async () => {
      const fixture = connectedFixture(Buffer.byteLength(request));
      try {
        for (const byte of Buffer.from(request + ending)) fixture.readable.write(Buffer.from([byte]));
        fixture.readable.end();
        await fixture.connected;
        expect(fixture.outcome()).toEqual({ status: "resolved" });
        expect(fixture.frames).toHaveLength(1);
        expect(JSON.parse(fixture.frames[0]!).id).toBe(1);
      } finally { await fixture.cleanup(); }
    });
  }

  it("counts UTF-8 bytes rather than string length", async () => {
    const fixture = connectedFixture(Buffer.byteLength(request) - 1, true);
    try {
      fixture.readable.write(request + "\n");
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected" });
      expect(fixture.frames).toEqual([]);
    } finally { await fixture.cleanup(); }
  });

  it("resets the per-line capacity across CRLF and multiple lines in one chunk", async () => {
    const fixture = connectedFixture(Buffer.byteLength(request));
    try {
      fixture.readable.write(request + "\r");
      fixture.readable.end("\n" + request + "\n" + request);
      await fixture.connected;
      expect(fixture.outcome()).toEqual({ status: "resolved" });
      expect(fixture.frames).toHaveLength(3);
      expect(fixture.frames.map(frame => JSON.parse(frame).id)).toEqual([1, 1, 1]);
    } finally { await fixture.cleanup(); }
  });

  it("preserves split surrogate strings at the exact UTF-8 boundary", async () => {
    const fixture = connectedFixture(Buffer.byteLength(request), true);
    try {
      for (let index = 0; index < request.length; index++) fixture.readable.write(request[index]);
      fixture.readable.end("\n");
      await fixture.connected;
      expect(fixture.outcome()).toEqual({ status: "resolved" });
      expect(fixture.frames).toHaveLength(1);
      expect(JSON.parse(fixture.frames[0]!).id).toBe(1);
    } finally { await fixture.cleanup(); }
  });

  it("processes admitted preceding lines but stops before an oversized line", async () => {
    const fixture = connectedFixture(Buffer.byteLength(request));
    try {
      fixture.readable.write(request + "\n" + "x".repeat(Buffer.byteLength(request) + 1) + "\n" + request + "\n");
      await setImmediate();
      expect(fixture.outcome()).toMatchObject({ status: "rejected" });
      expect(fixture.frames).toHaveLength(1);
      expect(JSON.parse(fixture.frames[0]!).id).toBe(1);
    } finally { await fixture.cleanup(); }
  });
});
