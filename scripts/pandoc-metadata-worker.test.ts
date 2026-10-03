import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it.each([["json", "json"], ["csv", "html"], ["json", "odt"]])("retains %s metadata to %s with external R2 pages in workerd", async (from, to) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = from === "csv" ? "head\nbody" : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {nested: {t: "MetaMap", c: {keep: {t: "MetaBool", c: true}, remove: {t: "MetaString", c: "old"}}}}, blocks: [{t: "Para", c: [{t: "Str", c: "body"}]}]});
  const bundled = await build({stdin: {resolveDir: root, contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent"});
  const runtime = new Miniflare({modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api = (() => {const module = {exports: {}}; ${bundled.outputFiles[0]!.text}; return module.exports;})();
    export default {async fetch(request, env) {
      const mode = new URL(request.url).pathname.slice(1), encoder = new TextEncoder();
      const namespace = new api.MemoryFileSystem(); await namespace.mkdir("/spill");
      const {fs, events} = api.createR2PagedFixture(namespace, env.PAGES);
      const controller = new AbortController();
      let hash = 2166136261, length = 0, largest = 0, closed = 0, aborted = 0, finalized = 0, filtered = 0, error;
      const chunks = async function* () {
        try {
          yield encoder.encode('{"title":"');
          const reused = new Uint8Array(8192);
          for (let i = 0; i < 8; i++) {
            reused.fill(120); yield reused;
            if (i === 4 && mode === "source-error") throw new Error("Metadata source failed");
            if (i === 4 && mode === "cancel") controller.abort();
          }
          yield encoder.encode('","nested":{"remove":null,"added":true}}');
        } finally {finalized++;}
      };
      try {
        await api.convertToOutput([{bytes: encoder.encode(${JSON.stringify(source)})}], {
          from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, standalone: ${to !== "json"},
          metadataFiles: [{chunks: chunks(), source: "/metadata.json"}], filters: [{kind: "json", path: "filter"}]
        }, {
          workingFiles: {fs, directory: "/spill", cacheBytes: 16384}, signal: controller.signal,
          filters: {async apply() {throw new Error("Resident filter forbidden");}, async applyJsonStream({stdin, stdout}) {
            filtered++; for await (const bytes of stdin) await stdout.write(bytes.map(byte => byte === 120 ? 121 : byte));
          }},
          output: {async write(bytes) {
            if (mode === "sink-error") throw new Error("Destination failed");
            await scheduler.wait(1);
            length += bytes.length; largest = Math.max(largest, bytes.length);
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
          }, async close() {closed++;}, async abort() {aborted++;}}
        });
      } catch (caught) {error = {code: caught.code, message: caught.message};}
      return Response.json({length, largest, hash, closed, aborted, finalized, filtered, error, events,
        remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir("/spill")});
    }};
  `});
  try {
    const {convert} = await import("../packages/safe-bash-command-pandoc/dist/index.js");
    const expected = await convert([{bytes: new TextEncoder().encode(source)}], {from: from!, to: to!, standalone: to !== "json",
      metadataFiles: [{bytes: new TextEncoder().encode(JSON.stringify({title: "y".repeat(65536), nested: {remove: null, added: true}}))}]}, {});
    const bytes = expected.kind === "binary" ? expected.bytes : new TextEncoder().encode(expected.text);
    let hash = 2166136261; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    for (const mode of ["success", "source-error", "cancel", "sink-error"]) {
      const response = await runtime.dispatchFetch("https://metadata.test/" + mode);
      expect(response.status).toBe(200);
      const result = await response.json() as {error?: {code: string}; largest: number; events: {opened: number; closed: number; writes: number; reads: number; peakHandles: number; largestTransfer: number}};
      expect(result).toMatchObject({remaining: 0, namespace: [], finalized: 1});
      expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened);
      expect(result.events.peakHandles).toBeLessThanOrEqual(7); expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
      if (mode === "success" || mode === "sink-error") expect(result.events.reads).toBeGreaterThan(0);
      expect(result.events.writes).toBeGreaterThan(0); expect(result.largest).toBeLessThanOrEqual(16384);
      if (mode === "success") {
        expect(result.error).toBeUndefined(); expect(result).toMatchObject({hash, length: bytes.length, closed: 1, aborted: 0, filtered: 1});
      } else {
        expect(result).toMatchObject({length: 0, closed: 0, aborted: mode === "sink-error" ? 1 : 0, filtered: mode === "sink-error" ? 1 : 0});
        expect(result.error?.code).toBe(mode === "cancel" ? "E_CANCELLED" : "E_IO");
      }
    }
  } finally {await runtime.dispose();}
}, 60000);
