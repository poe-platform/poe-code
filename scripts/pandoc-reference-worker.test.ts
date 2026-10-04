import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it.each(["sdk", "command"].flatMap(mode => ["json", "rtf", "csv", "tsv"].map(from => ({mode, from}))))("retains finite $from reference budgets through the public $mode in workerd", async ({mode, from}) => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {createPandocCommand} from "./packages/safe-bash-command-pandoc/dist/command.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `}, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, logLevel: "silent"});
  const runtime = new Miniflare({modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api = (() => {const module = {exports: {}}; ${bundle.outputFiles[0]!.text}; return module.exports;})();
    export default {async fetch(request, env) {
      const namespace = new api.MemoryFileSystem(); await namespace.mkdir('/spill');
      await namespace.writeFile('/input.json', new Uint8Array());
      const {fs: backing, events} = api.createR2PagedFixture(namespace, env.PAGES);
      const value = 'x'.repeat(${mode === 'command' ? 600000 : 17000});
      const json = JSON.stringify({'pandoc-api-version': [1,23,1,2], meta: {}, blocks: [{t: 'Para', c: [{t: 'Str', c: value}]}]});
      const from = ${JSON.stringify(from)}, input = from === 'rtf' ? '{' + String.fromCharCode(92) + 'rtf1 ' + value + '}' : from === 'json' ? json : value;
      await env.PAGES.put('/input.json', input);
      const fs = new Proxy(backing, {get(target, key) {
        if (key === 'readFile') return async () => {throw new Error('Whole file forbidden');};
        if (key === 'readStream') return async function* (path) {const object = await env.PAGES.get(path); if (!object) throw new Error('Missing input'); yield* object.body;};
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      }});
      let text = '', largest = 0, closed = 0;
      const output = {async write(bytes) {text += new TextDecoder().decode(bytes); largest = Math.max(largest, bytes.length);}, async close() {closed++;}, async abort() {}};
      const limits = {references: 10000, text: 2000000, nodes: 1000, depth: 64};
      if (${JSON.stringify(mode)} === 'sdk') {
        await api.convertToOutput([{chunks: fs.readStream('/input.json')}], {from, to: 'json'}, {limits, workingFiles: {fs, directory: '/spill', cacheBytes: 16384}, output});
      } else {
        const result = await api.createPandocCommand({limits}).execute({command: 'pandoc', args: ['-f' + from, '-tjson', '/input.json'], cwd: '/', env: {TMPDIR: '/spill'}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: output, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
        if (result.exitCode !== 0) throw new Error('Command failed'); closed++;
      }
      await env.PAGES.delete('/input.json');
      const matches = from === 'json' || from === 'rtf' ? text === json + '\\n' : JSON.parse(text).blocks[0].c[3][1][0][1][0][4][0].c[0].c === value;
      return Response.json({matches, largest, closed, events, remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir('/spill')});
    }};
  `});
  try {
    const response = await runtime.dispatchFetch("https://references.test/");
    expect(response.status, response.status === 200 ? undefined : await response.text()).toBe(200);
    const result = await response.json() as {largest: number; events: {opened: number; closed: number; reads: number; writes: number; largestTransfer: number}};
    expect(result).toMatchObject({matches: true, closed: 1, remaining: 0, namespace: []});
    expect(result.largest).toBeLessThanOrEqual(16384);
    expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened);
    expect(result.events.reads).toBeGreaterThan(0); expect(result.events.writes).toBeGreaterThan(0);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
  } finally {await runtime.dispose();}
}, 60000);
