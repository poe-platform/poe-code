import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";
// Authored PNG: a stored DEFLATE block containing one gray scanline, not a fixture.
function png(width = 1, height = 1): Uint8Array {
  const u32 = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  function chunk(name: string, data: number[]): number[] {
    const body = [...name].map(c => c.charCodeAt(0)).concat(data);
    let crc = 0xffffffff;
    for(const byte of body) {crc ^= byte; for(let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
    return [...u32(data.length), ...body, ...u32((crc ^ 0xffffffff) >>> 0)];
  }
  return new Uint8Array([137,80,78,71,13,10,26,10,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8,0,0,0,0]),
    ...chunk("IDAT", [0x78,0x01,0x01,2,0,253,255,0,128,0,130,0,129]), ...chunk("IEND", [])]);
}
// A one-component baseline JPEG: DC zero and EOB, with explicit one-bit tables.
function jpeg(progressive = false): Uint8Array {
  const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
  return new Uint8Array([255,216, ...segment(219, [0, ...Array<number>(64).fill(1)]),
    ...segment(progressive ? 194 : 192, [8,0,1,0,1,1,1,0x11,0]),
    ...segment(196, [0,1,...Array<number>(15).fill(0),0, 16,1,...Array<number>(15).fill(0),0]),
    ...(progressive ? [...segment(218,[1,1,0,0,0,0]),0x7f,...segment(218,[1,1,0,1,63,0]),0x7f] : [...segment(218, [1,1,0,0,63,0]), 0x3f]),255,217]);
}

it.each(["png", "jpeg", "progressive"].flatMap(format => ["filesystem", "resolver"].flatMap(capability => ["rtf", "odt"].map(to => ({format, capability, to})))))("retains streamed $format pictures from $capability into $to in R2 under workerd", async ({format, capability, to}) => {
  const bytes = format === "png" ? png() : jpeg(format === "progressive");
  const input = {"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "CodeBlock", c: [["",[],[]], "x".repeat(65536)]}, {t: "Para", c: [{t: "Image", c: [["",[],[]], [], ["picture", ""]]}]}]};
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundled = await build({stdin: {resolveDir: root, contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent"});
  const runtime = new Miniflare({modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api = (() => {const module = {exports: {}}; ${bundled.outputFiles[0]!.text}; return module.exports;})();
    export default {async fetch(request, env) {
      const mode = new URL(request.url).pathname.slice(1), namespace = new api.MemoryFileSystem();
      await namespace.mkdir("/spill");
      const {fs, events} = api.createR2PagedFixture(namespace, env.PAGES), controller = new AbortController();
      let length = 0, hash = 2166136261, closed = 0, aborted = 0, returned = 0, pulls = 0, error, largest = 0;
      try {
        await api.convertToOutput([{bytes: new TextEncoder().encode(${JSON.stringify(JSON.stringify(input))})}], {from: "json", to: ${JSON.stringify(to)}, resourcePath: ["/images"]}, {
          limits: {references: 2000000, retainedBytes: 32000000}, signal: controller.signal, workingFiles: {fs, directory: "/spill", cacheBytes: 16384},
          ${capability === "resolver" ? "resources" : "resourceFiles"}: {
            async lstat(path) {return {type: (path === "/" || path === "/images") ? "directory" : "file"};},
            async readFile() {throw new Error("Full resource reads forbidden");}, async mkdir() {}, async writeFile() {},
            ${capability === "resolver" ? "resolveStream" : "readStream"}(path) {
              if (mode === "pending-cancel" || mode === "factory-cancel") {
                let releasePull;
                if (mode === "factory-cancel") controller.abort();
                return {[Symbol.asyncIterator]() {return {
                  next() {pulls++; controller.abort(); return new Promise(resolve => {releasePull = resolve;});},
                  async return() {returned++; releasePull?.({done: true}); return {done: true};}
                };}};
              }
              return (async function* () {
              if (path !== ${JSON.stringify(capability === "resolver" ? "picture" : "/images/picture")}) throw new Error("Wrong resource search root");
              const bytes = new Uint8Array(${JSON.stringify([...bytes])}), reused = new Uint8Array(7);
              for (let offset = 0; offset < bytes.length; offset += 7) {
                if (offset > 7 && mode === "source-failure") throw new Error("Resource failed");
                if (offset > 7 && mode === "cancel") controller.abort();
                reused.fill(0); reused.set(bytes.subarray(offset, offset + 7)); yield reused.subarray(0, Math.min(7, bytes.length-offset));
              }
              })();
            }
          },
          output: {async write(bytes) {if (mode === "sink-failure") throw new Error("Sink failed"); await scheduler.wait(1); largest = Math.max(largest, bytes.length); length += bytes.length; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;}, async close() {closed++;}, async abort() {aborted++;}}
        });
      } catch (caught) {error = {code: caught.code, message: caught.message};}
      return Response.json({length, hash, closed, aborted, returned, pulls, largest, error, events, remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir("/spill")});
    }};
  `});
  try {
    const {convert} = await import("../packages/safe-bash-command-pandoc/dist/index.js");
    const expected = await convert([{bytes: new TextEncoder().encode(JSON.stringify(input))}], {from: "json", to}, {resources: {async resolve() {return bytes;}}});
    const expectedBytes = expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes;
    let expectedHash = 2166136261;
    for (const byte of expectedBytes) expectedHash = Math.imul(expectedHash ^ byte, 16777619) >>> 0;
    for (const mode of ["success", "source-failure", "cancel", "sink-failure", "pending-cancel", "factory-cancel"]) {
      const result = await (await runtime.dispatchFetch("https://pandoc.test/" + mode)).json() as {length: number; hash: number; error?: {code: string}; largest: number; events: {opened: number; closed: number; largestTransfer: number}};
      expect(result).toMatchObject({remaining: 0, namespace: []});
      if (mode === "pending-cancel" || mode === "factory-cancel") expect(result).toMatchObject({returned: 1, pulls: mode === "pending-cancel" ? 1 : 0});
      expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened); expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.largest).toBeLessThanOrEqual(16384);
      if (mode === "success") {expect(result.error).toBeUndefined(); expect(result).toMatchObject({length: expectedBytes.length, hash: expectedHash, closed: 1, aborted: 0});}
      else {expect(result).toMatchObject({length: 0, closed: 0}); expect(result.error?.code).toBe(mode.includes("cancel") ? "E_CANCELLED" : "E_IO");}
    }
  } finally {await runtime.dispose();}
}, 60_000);
