import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it.each(["json", "plain", "html5", "transformed-json", "transformed-plain", "transformed-html5", "csv-json", "csv-plain", "csv-html5"])("streams filter generations through external pages in workerd (%s)", async scenario => {
  const delimited = scenario.startsWith("csv-");
  const transformed = scenario.startsWith("transformed-");
  const target = scenario.endsWith("html5") ? "html5" : scenario.endsWith("plain") ? "plain" : "json";
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundled = await build({
    stdin: {resolveDir: root, contents: `
      export {convertToOutput, createJsonFilterCapability} from "./packages/safe-bash-command-pandoc/dist/index.js";
      export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
      export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
    `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent",
  });
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"],
    script: `
      const api = (() => {const module = {exports: {}}; ${bundled.outputFiles[0]!.text}; return module.exports;})();
      export default {async fetch(request, env) {
        const mode = new URL(request.url).pathname.slice(1);
        const namespace = new api.MemoryFileSystem();
        await namespace.mkdir("/spill");
        const {fs, events} = api.createR2PagedFixture(namespace, env.PAGES);
        const controller = new AbortController(), encoder = new TextEncoder();
        let calls = 0, length = 0, largest = 0, hash = 2166136261, closed = 0, aborted = 0, error;
        const filters = api.createJsonFilterCapability({
          async run() {throw new Error("Buffered protocol forbidden");},
          async runStream({stdin, stdout}) {
            calls++;
            for await (const chunk of stdin) {
              if (mode === "filter-cancel" && calls === 2) controller.abort();
              await stdout.write(chunk.map(byte => byte === 120 ? 121 : byte));
            }
            return mode === "filter-failure" && calls === 2 ? 1 : 0;
          }
        });
        try {
          await api.convertToOutput([{chunks: (async function* () {
            yield encoder.encode(${JSON.stringify(delimited ? "head\n" : '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"CodeBlock","c":[["",[],[]],"')});
            const reused = new Uint8Array(8192);
            for (let i = 0; i < 8; i++) {reused.fill(120); yield reused;}
            yield encoder.encode(${JSON.stringify(delimited ? "" : transformed ? '"]},{"t":"RawBlock","c":["html","<!--removed-->"]},{"t":"Header","c":[1,["",[],[]],[{"t":"Str","c":"tail"}]]}]}' : '"]}]}')});
          })()}], {from: ${JSON.stringify(delimited ? "csv" : "json")}, to: ${JSON.stringify(target)}, ${transformed ? "stripComments: true, shiftHeadingLevelBy: -1," : ""} filters: ["one", "two", "three"].map(path => ({kind: "json", path}))}, {
            filters, signal: controller.signal, workingFiles: {fs, directory: "/spill", cacheBytes: 16384},
            output: {async write(bytes) {
              if (mode === "output-failure") throw new Error("Destination failed");
              await scheduler.wait(1);
              length += bytes.length; largest = Math.max(largest, bytes.length);
              for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            }, async close() {closed++;}, async abort() {aborted++;}}
          });
        } catch (caught) {error = {code: caught.code, message: caught.message};}
        return Response.json({calls, length, largest, hash, closed, aborted, error, events,
          remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir("/spill")});
      }};
    `,
  });
  try {
    const table = delimited ? await (await import("../packages/safe-bash-command-pandoc/dist/index.js")).convert([{bytes: new TextEncoder().encode("head\n" + "y".repeat(65536))}], {from: "csv", to: target}, {}) : undefined;
    const expected = new TextEncoder().encode(table?.kind === "text" ? table.text : target === "html5" ? "<pre><code>" + "y".repeat(65536) + "</code></pre>\n" + (transformed ? "<p>tail</p>\n" : "") : target === "plain" ? "    " + "y".repeat(65536) + (transformed ? "\n\ntail\n" : "\n") : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "CodeBlock", c: [["",[],[]], "y".repeat(65536)]}, ...(transformed ? [{t: "Para", c: [{t: "Str", c: "tail"}]}] : [])]}) + "\n");
    let hash = 2166136261;
    for (const byte of expected) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    for (const mode of ["success", "filter-failure", "filter-cancel", "output-failure"]) {
      const response = await runtime.dispatchFetch("https://pandoc.test/" + mode);
      expect(response.status).toBe(200);
      const result = await response.json() as {calls: number; length: number; largest: number; error?: {code: string}; events: {opened: number; closed: number; reads: number; writes: number; peakHandles: number}};
      expect(result).toMatchObject({remaining: 0, namespace: [], events: {largestTransfer: 16384}});
      expect(result.events.opened).toBeGreaterThan(0);
      expect(result.events.closed).toBe(result.events.opened);
      expect(result.events.peakHandles).toBeLessThanOrEqual(5);
      expect(result.events.reads).toBeGreaterThan(0);
      expect(result.events.writes).toBeGreaterThan(0);
      expect(result.largest).toBeLessThanOrEqual(16384);
      if (mode === "success") {
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({calls: 3, length: expected.length, hash, closed: 1, aborted: 0});
      } else {
        expect(result).toMatchObject({length: 0, closed: 0, aborted: mode === "output-failure" ? 1 : 0});
        expect(result.calls).toBe(mode === "output-failure" ? 3 : 2);
        expect(result.error?.code).toBe(mode === "filter-cancel" ? "E_CANCELLED" : "E_IO");
      }
    }
  } finally {await runtime.dispose();}
}, 60_000);
