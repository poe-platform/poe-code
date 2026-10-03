import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it.each(["plain", "rtf", "odt"])("reads RTF through external R2 pages into %s", async to => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundled = await build({stdin: {resolveDir: root, contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent"});
  const prefix = String.raw`{\rtf1\ansi `, suffix = String.raw`{\b bold}\par end{\pict\pngblip 89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000d494441547801010200fdff008000820081c36e25e00000000049454e44ae426082}}`;
  const runtime = new Miniflare({modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api = (() => {const module = {exports: {}}; ${bundled.outputFiles[0]!.text}; return module.exports;})();
    export default {async fetch(request, env) {
      const mode = new URL(request.url).pathname.slice(1), namespace = new api.MemoryFileSystem();
      await namespace.mkdir("/spill");
      const {fs, events} = api.createR2PagedFixture(namespace, env.PAGES), controller = new AbortController();
      let length = 0, hash = 2166136261, closed = 0, aborted = 0, error, largest = 0;
      const encoder = new TextEncoder();
      async function* source() {
        yield encoder.encode(${JSON.stringify(prefix)});
        const reused = new Uint8Array(8192);
        for (let i = 0; i < 8; i++) {
          if (i === 3 && mode === "source-failure") throw new Error("Source failed");
          if (i === 3 && mode === "cancel") controller.abort();
          reused.fill(97 + i); yield reused;
        }
        yield encoder.encode(${JSON.stringify(suffix)});
      }
      try {
        await api.convertToOutput([{chunks: source()}], {from: "rtf", to: ${JSON.stringify(to)}}, {
          signal: controller.signal, workingFiles: {fs, directory: "/spill", cacheBytes: 16384},
          output: {async write(bytes) {
            if (mode === "sink-failure") throw new Error("Sink failed");
            await scheduler.wait(1); largest = Math.max(largest, bytes.length); length += bytes.length;
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
          }, async close() {closed++;}, async abort() {aborted++;}}
        });
      } catch (caught) {error = {code: caught.code, message: caught.message};}
      return Response.json({length, hash, closed, aborted, largest, error, events, remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir("/spill")});
    }};
  `});
  try {
    const {convert} = await import("../packages/safe-bash-command-pandoc/dist/index.js");
    const source = prefix + Array.from({length: 8}, (_, i) => String.fromCharCode(97 + i).repeat(8192)).join("") + suffix;
    const expected = await convert([{bytes: new TextEncoder().encode(source)}], {from: "rtf", to}, {});
    const bytes = expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    for (const mode of ["success", "source-failure", "cancel", "sink-failure"]) {
      const result = await (await runtime.dispatchFetch("https://pandoc.test/" + mode)).json() as {error?: {code: string}; largest: number; events: {opened: number; closed: number; largestTransfer: number; peakHandles: number}};
      expect(result).toMatchObject({remaining: 0, namespace: []});
      expect(result.events.opened).toBeGreaterThan(0);
      expect(result.events.closed).toBe(result.events.opened);
      expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
      expect(result.events.peakHandles).toBeLessThanOrEqual(8);
      expect(result.largest).toBeLessThanOrEqual(16384);
      if (mode === "success") {expect(result.error).toBeUndefined(); expect(result).toMatchObject({length: bytes.length, hash, closed: 1, aborted: 0});}
      else {expect(result).toMatchObject({length: 0, closed: 0}); expect(result.error?.code).toBe(mode === "cancel" ? "E_CANCELLED" : "E_IO");}
    }
  } finally {await runtime.dispose();}
}, 60_000);
