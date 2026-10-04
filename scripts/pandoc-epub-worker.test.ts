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
