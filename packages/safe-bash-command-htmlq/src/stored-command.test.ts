import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts/command";
import { htmlq } from "./command.js";

test("command projection stores its DOM in caller storage and retires backing files", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  let opens = 0, outputBytes = 0, active = 0, peak = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Payload-wide filesystem I/O"); };
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => { opens++; return fs.open(...args); };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const context = {
    command: "htmlq", args: [], fs: guarded, cwd: "/scratch", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {
      const chunk = new TextEncoder().encode(`<p>${"x".repeat(4096)}<b>removed</b></p>`);
      for (let i = 0; i < 80; i++) yield chunk;
    })(),
    stdout: { async write(bytes: Uint8Array) {
      active += bytes.byteLength; peak = Math.max(peak, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const byte of bytes) assert.ok(byte === 120 || byte === 10);
      outputBytes += bytes.byteLength; active -= bytes.byteLength;
    } },
    stderr: { async write() { assert.fail("Unexpected diagnostic"); } }
  } as unknown as CommandContext;
  assert.equal((await htmlq(context, { selector: "p", text: true, removeNodes: ["b"] })).exitCode, 0);
  assert.equal(outputBytes, 80 * 4097);
  assert.ok(opens > 0, "The command must spill its document through the injected filesystem");
  assert.ok(peak <= 16384); assert.equal(active, 0);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const during of ["spill", "sink", "abort"] as const) {
  test(`stored command preserves ${during} failure and closes its retained descriptor`, async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
    const controller = new AbortController(), primary = new Error(during), cleanup = new Error("close");
    let closed = 0, returned = 0;
    const guarded = new Proxy(fs, { get(target, key) {
      if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        return new Proxy(handle, { get(target, key) {
          if (key === "write" && during !== "sink") return async () => {
            if (during === "abort") controller.abort(primary);
            throw primary;
          };
          if (key === "close") return async (...args: Parameters<typeof handle.close>) => {
            closed++; await handle.close(...args); if (during !== "abort") throw cleanup;
          };
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const context = {
      command: "htmlq", args: [], fs: guarded, cwd: "/scratch", env: {}, signal: controller.signal,
      stdin: (async function* () {
        try {
          const bytes = new TextEncoder().encode(`<p>${"x".repeat(4096)}</p>`);
          for (let i = 0; i < 80; i++) yield bytes;
        } finally { returned++; }
      })(),
      stdout: { async write() { throw primary; } }, stderr: { async write() { assert.fail("Unexpected diagnostic"); } }
    } as unknown as CommandContext;
    const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    await assert.rejects(htmlq(context, { selector: "p", text: true }), error => {
      assert.deepEqual(leaves(error), during === "abort" ? [primary] : [primary, cleanup]); return true;
    });
    assert.equal(closed, 1); assert.equal(returned, 1);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

test("base detection and href rewriting keep large values out of native URL", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = globalThis.URL;
  globalThis.URL = class extends original {
    constructor(input: string | URL, base?: string | URL) {
      assert.ok(String(input).length + String(base ?? "").length <= 4096, "Payload-wide native URL call");
      super(input, base);
    }
  };
  const prefix = "https://example.test/joined\n", payloadLength = 16 * 4096;
  let offset = 0, peak = 0;
  const context = {
    command: "htmlq", args: [], fs, cwd: "/scratch", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {
      const encode = (value: string) => new TextEncoder().encode(value), chunk = encode("x".repeat(4096));
      yield encode('<base href="https://example.test/');
      for (let i = 0; i < 16; i++) yield chunk;
      yield encode('/file"><a href="../joined">A</a><a href="////');
      for (let i = 0; i < 16; i++) yield chunk;
      yield encode('">B</a>');
    })(),
    stdout: { async write(bytes: Uint8Array) {
      peak = Math.max(peak, bytes.length); await new Promise<void>(resolve => setImmediate(resolve));
      for (const byte of bytes) {
        assert.equal(byte, offset < prefix.length ? prefix.charCodeAt(offset) : offset < prefix.length + payloadLength ? 120 : 10);
        offset++;
      }
    } }, stderr: { async write() { assert.fail("Unexpected diagnostic"); } }
  } as unknown as CommandContext;
  try {
    assert.equal((await htmlq(context, { selector: "a", attributes: ["href"], detectBase: true })).exitCode, 0);
    assert.equal(offset, prefix.length + payloadLength + 1); assert.ok(peak <= 16384);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  } finally { globalThis.URL = original; }
});
