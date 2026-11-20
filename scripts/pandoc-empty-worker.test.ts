import { workerdBundle } from "./workerd-bundle.fixture.js";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it("loads the real precompiled converter for DOCX and PDF exports in workerd", async () => {
  const bundle = await build({
    stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: 'export {convert} from "safe-bash-command-pandoc";'},
    bundle: true, platform: "browser", conditions: ["workerd"], format: "esm",
    loader: {".wasm": "copy"}, outdir: "out/workerd-fixture", write: false, logLevel: "silent",
  });
  const runtime = new Miniflare({compatibilityDate: "2026-07-01", cf: false, ...workerdBundle(bundle, `
    export default {async fetch() {
      if (typeof Buffer !== "undefined" || typeof process !== "undefined") throw new Error("Node globals present");
      const outputs = [];
      for (const to of ["docx", "pdf"]) {
        const result = await api.convert([{bytes: new TextEncoder().encode("# Real WASM export")}], {from: "commonmark", to}, {yield: async () => {}});
        const readback = await api.convert([{bytes: result.bytes}], {from: to, to: "plain"}, {yield: async () => {}});
        outputs.push({to, signature: [...result.bytes.subarray(0, 4)], text: readback.text.trim()});
      }
      return Response.json(outputs);
    }};
  `)});
  try {
    const response = await runtime.dispatchFetch("https://documents.test/");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual([
      {to: "docx", signature: [80, 75, 3, 4], text: "Real WASM export"},
      {to: "pdf", signature: [37, 80, 68, 70], text: "Real WASM export"},
    ]);
  } finally {await runtime.dispose();}
}, 30000);

it("retains a zero-input SDK filter response in caller R2 storage", async () => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput, createJsonFilterCapability} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", loader: { ".wasm": "copy" }, outdir: "out/workerd-fixture", write: false, logLevel: "silent"});
  const runtime = new Miniflare({compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], ...workerdBundle(bundle, `
    export default {async fetch(request, env) {
      const namespace = new api.MemoryFileSystem(); await namespace.mkdir('/spill');
      const {fs: backing, events} = api.createR2PagedFixture(namespace, env.PAGES);
      const fs = new Proxy(backing, {get(target, key) {
        if (key === 'readFile') return async () => {throw new Error('Whole file forbidden');};
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      }});
      let length = 0, largest = 0, closed = 0;
      const output = {async write(bytes) {length += bytes.length; largest = Math.max(largest, bytes.length);}, async close() {closed++;}, async abort() {}};
      const encoder = new TextEncoder();
      const filters = api.createJsonFilterCapability({async runStream({stdin, stdout}) {
        for await (const bytes of stdin) void bytes;
        await stdout.write(encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"'));
        for (let i = 0; i < 40; i++) await stdout.write(encoder.encode('x'.repeat(16384)));
        await stdout.write(encoder.encode('"}]}]}'));
        return 0;
      }});
      await api.convertToOutput([], {from: 'commonmark', to: 'plain', filters: [{kind: 'json', path: '/filter'}]}, {
        filters, limits: {retainedBytes: 64000000, references: 10000}, workingFiles: {fs, directory: '/spill', cacheBytes: 16384}, output
      });
      return Response.json({length, largest, closed, files: await namespace.readdir('/spill'), events});
    }};
  `) });
  try {
    const response = await runtime.dispatchFetch("http://worker.test/");
    expect(response.status).toBe(200);
    const result = await response.json() as {length: number; largest: number; closed: number; files: string[]; events: {writes: number}};
    expect(result.length).toBe(40 * 16384 + 1);
    expect(result.largest).toBeLessThanOrEqual(16384);
    expect(result.closed).toBe(1);
    expect(result.files).toEqual([]);
    expect(result.events.writes).toBeGreaterThan(0);
  } finally {await runtime.dispose();}
}, 120000);
