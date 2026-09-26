import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

for (const condition of ["browser", "workerd"]) describe(`${condition} memory writes without Node globals`, () => {
  let bundle: string;
  beforeAll(async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL("../src/core.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      conditions: [condition],
      format: "iife",
      globalName: "safeFs",
      target: "es2022",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    expect(Object.values(output.metafile!.inputs).flatMap(input => input.imports).filter(input => input.external)).toEqual([]);
    expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/browser.ts"))).toBe(true);
    expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/node.ts"))).toBe(false);
    bundle = output.outputFiles[0]!.text;
  });

  function realm() {
    const backing = Buffer.alloc(35, 99);
    const chunk = backing.subarray(1, 34);
    chunk.fill(1);
    const context = createContext({
      AbortController, AbortSignal, Headers, Response, Request, URL, TextEncoder, TextDecoder,
      ReadableStream, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout, DOMException, chunk,
    });
    runInContext(bundle, context);
    expect(runInContext("typeof Buffer", context)).toBe("undefined");
    return { context, backing };
  }

  it("preserves prior bytes when a stream grows and copies reused Buffer subviews", async () => {
    const { context, backing } = realm();
    const bytes = await runInContext(`(async () => {
      const fs = new safeFs.MemoryFileSystem();
      async function* source() {
        yield chunk;
        chunk.fill(2);
        yield chunk;
        chunk.fill(9);
      }
      await fs.writeStream("/file", source());
      return [...await fs.readFile("/file")];
    })()`, context);
    expect(bytes).toEqual([...new Array(33).fill(1), ...new Array(33).fill(2)]);
    expect([backing[0], backing[34]]).toEqual([99, 99]);
  });

  it("writes only admitted prefixes of reused Buffer subviews through redirect handles", async () => {
    const { context, backing } = realm();
    const bytes = await runInContext(`(async () => {
      const fs = new safeFs.MemoryFileSystem();
      const handle = safeFs.tryOpenMemoryRedirectHandleSync(fs, "/file", false, 0o666);
      if (!handle) throw new Error("stock memory redirect was not admitted");
      try {
        handle.writeRangeSync(chunk, 2);
        chunk.fill(2);
        handle.writeRangeSync(chunk, 1);
        chunk.fill(9);
      } finally { handle.close(); }
      return [...await fs.readFile("/file")];
    })()`, context);
    expect(bytes).toEqual([1, 1, 2]);
    expect([backing[0], backing[34]]).toEqual([99, 99]);
  });

  it("zero-fills the cursor gap after truncation without reviving discarded bytes", async () => {
    const { context } = realm();
    const bytes = await runInContext(`(async () => {
      const fs = new safeFs.MemoryFileSystem();
      async function* source() {
        yield chunk;
        await fs.truncate("/file", 1);
        chunk.fill(9);
        yield new Uint8Array();
        yield Uint8Array.of(2);
      }
      await fs.writeStream("/file", source());
      return [...await fs.readFile("/file")];
    })()`, context);
    expect(bytes).toEqual([1, ...new Array(32).fill(0), 2]);
  });
});
