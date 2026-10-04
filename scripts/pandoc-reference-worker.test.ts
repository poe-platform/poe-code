import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

it.each(["sdk", "command"].flatMap(mode => ["json", "rtf", "csv", "tsv"].flatMap(from => ["json", "plain", "html5", "rst", "gfm", "latex", "rtf", "odt", ...(["json", "rtf"].includes(from) ? ["commonmark"] : [])].map(to => ({mode, from, to, transform: false, metadata: false, filter: false})))) .concat(["sdk", "command"].flatMap(mode => ["json", "html5"].map(to => ({mode, from: "json", to, transform: true, metadata: false, filter: false})))).concat(["sdk", "command"].map(mode => ({mode, from: "json", to: "json", transform: false, metadata: true, filter: false}))).concat(["sdk", "command"].map(mode => ({mode, from: "json", to: "json", transform: false, metadata: false, filter: true}))))("retains finite $from-to-$to reference budgets through the public $mode in workerd with transforms=$transform metadata=$metadata filter=$filter", async ({mode, from, to, transform, metadata, filter}) => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput, createJsonFilterCapability} from "./packages/safe-bash-command-pandoc/dist/index.js";
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
      const transform = ${transform}, metadata = ${metadata}, filter = ${filter};
      const inputJson = transform ? JSON.stringify({'pandoc-api-version': [1,23,1,2], meta: {}, blocks: [{t: 'Header', c: [1, ['', [], []], [{t: 'Str', c: value}]]}, {t: 'RawBlock', c: ['html', '<!--' + value + '-->']}]}) : json;
      const from = ${JSON.stringify(from)}, to = ${JSON.stringify(to)}, input = from === 'rtf' ? '{' + String.fromCharCode(92) + 'rtf1 ' + value + '}' : from === 'json' ? inputJson : value;
      await env.PAGES.put('/input.json', input);
      const fs = new Proxy(backing, {get(target, key) {
        if (key === 'readFile') return async () => {throw new Error('Whole file forbidden');};
        if (key === 'readStream') return async function* (path) {const object = await env.PAGES.get(path); if (!object) throw new Error('Missing input'); yield* object.body;};
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      }});
      let text = '', largest = 0, closed = 0;
      const output = {async write(bytes) {text += new TextDecoder().decode(bytes); largest = Math.max(largest, bytes.length);}, async close() {closed++;}, async abort() {}};
      const limits = {references: (to === 'latex' || to === 'rtf') ? 2000000 : 10000, text: (metadata || filter) ? 6000000 : transform ? 4000000 : 2000000, nodes: 1000, depth: 64};
      if (${JSON.stringify(mode)} === 'sdk') {
        await api.convertToOutput([{chunks: fs.readStream('/input.json')}], {from, to, ...(filter ? {filters: [{kind: "json", path: "/filter"}]} : {}), ...(metadata ? {metadataJson: [{title: value}]} : {}), ...(transform ? {stripComments: true, shiftHeadingLevelBy: -1} : {})}, {limits, ...(filter ? {filters: api.createJsonFilterCapability({async runStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes); return 0;}})} : {}), workingFiles: {fs, directory: '/spill', cacheBytes: 16384}, output});
      } else {
        const result = await api.createPandocCommand({limits, ...(filter ? {jsonFilterCommand: "filter-runtime"} : {})}).execute({command: 'pandoc', args: ['-f' + from, '-t' + to, ...(filter ? ['--filter', '/filter'] : []), ...(metadata ? ['--metadata', 'title=' + value] : []), ...(transform ? ['--strip-comments', '--shift-heading-level-by=-1'] : []), '/input.json'], async invoke(name, args, streams) {if (name !== 'filter-runtime' || args[1] !== '/filter') throw new Error('Wrong filter invocation'); for await (const bytes of streams.stdin) await streams.stdout.write(bytes); return {exitCode: 0};}, cwd: '/', env: {TMPDIR: '/spill'}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: output, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
        if (result.exitCode !== 0) throw new Error('Command failed'); closed++;
      }
      await env.PAGES.delete('/input.json');
      const matches = to === 'odt' ? text.startsWith('PK') && text.includes(value) : to === 'rtf' ? text.startsWith('{\\\\rtf1') && text.includes(value) : to === 'latex' ? (from === 'json' || from === 'rtf' ? text === value + '\\n' : text.startsWith('\\\\begin{longtable}') && text.includes(value)) : to === 'gfm' ? (from === 'json' || from === 'rtf' ? text === value + '\\n' : text === '| ' + value + ' |\\n| --- |\\n') : to === 'commonmark' ? text === value + '\\n' : to === 'rst' ? (from === 'json' || from === 'rtf' ? text === value + '\\n' : text.startsWith('.. list-table::') && text.includes(value)) : to === 'html5' ? (from === 'json' || from === 'rtf' ? text === '<p>' + value + '</p>\\n' : text.includes('>' + value + '</th>')) : to === 'plain' ? text === value + '\\n' : from === 'json' || from === 'rtf' ? text === (metadata ? JSON.stringify({...JSON.parse(json), meta: {title: {t: 'MetaString', c: value}}}) : json) + '\\n' : JSON.parse(text).blocks[0].c[3][1][0][1][0][4][0].c[0].c === value;
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
