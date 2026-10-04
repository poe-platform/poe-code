import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it.each(["sync", "async"].flatMap(kind => [false, true].map(cleanupFails => ({kind, cleanupFails}))))
("retires an EPUB $kind source cancelled by its factory in workerd, cleanupFails=$cleanupFails", async ({kind, cleanupFails}) => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent"});
  const runtime = new Miniflare({modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api = (() => {const module = {exports: {}}; ${bundle.outputFiles[0]!.text}; return module.exports;})();
    export default {async fetch(request, env) {
      const namespace = new api.MemoryFileSystem(); await namespace.mkdir('/spill');
      const {fs, events} = api.createR2PagedFixture(namespace, env.PAGES);
      fs.readFile = async () => {throw new Error('Whole file forbidden');};
      const controller = new AbortController();
      let pulls = 0, returns = 0, writes = 0, closes = 0, aborts = 0, code;
      const next = () => {pulls++; return {done: false, value: new Uint8Array(32768)};};
      const close = () => {returns++; if (${cleanupFails}) throw new Error('Cleanup failed'); return {done: true};};
      const chunks = ${JSON.stringify(kind)} === 'async'
        ? {[Symbol.asyncIterator]() {controller.abort(); return {next: async () => next(), return: async () => close()};}}
        : {[Symbol.iterator]() {controller.abort(); return {next, return: close};}};
      try {
        await api.convertToOutput([{chunks}], {from: 'epub', to: 'plain'}, {
          signal: controller.signal, workingFiles: {fs, directory: '/spill', cacheBytes: 16384},
          output: {async write() {writes++;}, async close() {closes++;}, async abort() {aborts++;}}
        });
      } catch (error) {code = error.code;}
      return Response.json({code, pulls, returns, writes, closes, aborts, events,
        remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir('/spill')});
    }};
  `});
  try {
    const response = await runtime.dispatchFetch("https://epub.test/");
    expect(response.status, response.status === 200 ? undefined : await response.text()).toBe(200);
    const result = await response.json() as {events: {opened: number; closed: number}};
    expect(result).toMatchObject({code: "E_CANCELLED", pulls: 0, returns: 1, writes: 0, closes: 0, aborts: 0, remaining: 0, namespace: []});
    expect(result.events.closed).toBe(result.events.opened);
  } finally {await runtime.dispose();}
}, 60000);

it.each([16385, 262145])("rejects a %i-byte EPUB mimetype without a whole-member decode in workerd", async size => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {createZipCodec} from "@poe-code/office-package/zip";
    export {createCompressionCodec} from "@poe-code/compression";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent"});
  const runtime = new Miniflare({modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api = (() => {const module = {exports: {}}; ${bundle.outputFiles[0]!.text}; return module.exports;})();
    export default {async fetch(request, env) {
      const signal = new AbortController().signal;
      const limits = {maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 4096};
      const zip = api.createZipCodec({compression: api.createCompressionCodec(), yieldTurn: async () => {}, fail(message) {throw new Error(message);}});
      const entry = await zip.makeZipEntry('mimetype', new Uint8Array(${size}).fill(65), {modified: new Date('1980-01-01T00:00:00Z'), mode: 0o100644, directory: false, symlink: false, compression: 'store'}, limits, signal);
      const archive = await zip.writeZipArchive({entries: [entry], comment: new Uint8Array()}, limits, signal);
      await env.PAGES.put('/input', archive);
      const namespace = new api.MemoryFileSystem(); await namespace.mkdir('/spill');
      const {fs, events} = api.createR2PagedFixture(namespace, env.PAGES);
      fs.readFile = async () => {throw new Error('Whole file forbidden');};
      const originalDecode = TextDecoder.prototype.decode;
      let largestDecode = 0, writes = 0, closes = 0, code, message;
      TextDecoder.prototype.decode = function(input, options) {
        largestDecode = Math.max(largestDecode, input?.byteLength ?? 0);
        if (largestDecode > 4096) throw new Error('Whole member decode forbidden');
        return originalDecode.call(this, input, options);
      };
      const object = await env.PAGES.get('/input');
      try {
        await api.convertToOutput([{chunks: object.body}], {from: 'epub', to: 'plain'}, {
          workingFiles: {fs, directory: '/spill', cacheBytes: 16384},
          output: {async write() {writes++;}, async close() {closes++;}, async abort() {}}
        });
      } catch (error) {code = error.code; message = error.message;}
      finally {TextDecoder.prototype.decode = originalDecode;}
      await env.PAGES.delete('/input');
      return Response.json({code, message, largestDecode, writes, closes, events,
        remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir('/spill')});
    }};
  `});
  try {
    const response = await runtime.dispatchFetch("https://epub.test/");
    expect(response.status, response.status === 200 ? undefined : await response.text()).toBe(200);
    const result = await response.json() as {largestDecode: number; events: {opened: number; closed: number; largestTransfer: number}};
    expect(result).toMatchObject({code: "E_PARSE", message: "Invalid or missing EPUB mimetype", writes: 0, closes: 0, remaining: 0, namespace: []});
    expect(result.largestDecode).toBeLessThanOrEqual(4096);
    expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
  } finally {await runtime.dispose();}
}, 60000);
