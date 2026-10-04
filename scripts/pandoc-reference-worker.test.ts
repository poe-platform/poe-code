import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect, it} from "vitest";

const modes = ["sdk", "command"];
const ordinary = {transform: false, metadata: false, filter: false, lua: false, template: false, crlf: false, writerOptions: false, byteQuota: false, joined: false, fileScope: false};
const cases = modes.flatMap(mode => ["json", "rtf", "csv", "tsv"].flatMap(from =>
  ["json", "plain", "html5", "rst", "gfm", "latex", "rtf", "odt", ...(["json", "rtf"].includes(from) ? ["commonmark"] : [])]
    .map(to => ({mode, from, to, ...ordinary}))));
cases.push(...modes.flatMap(mode => ["json", "html5"].map(to => ({mode, from: "json", to, ...ordinary, transform: true}))));
for (const option of ["metadata", "filter", "lua", "crlf"] as const)
  cases.push(...modes.map(mode => ({mode, from: "json", to: "json", ...ordinary, [option]: true})));
cases.push(...modes.map(mode => ({mode, from: "json", to: "html5", ...ordinary, template: true})));
cases.push(...modes.flatMap(mode => ["gfm", "rtf"].map(to => ({mode, from: "json", to, ...ordinary, writerOptions: true}))));
cases.push(...modes.flatMap(mode => ["gfm", "rtf"].map(to => ({mode, from: "json", to, ...ordinary, writerOptions: true, byteQuota: true}))));
cases.push(...modes.flatMap(mode => ["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"].map(to => ({mode, from: "json", to, ...ordinary, byteQuota: true}))));
cases.push(...modes.flatMap(mode => ["csv", "tsv"].flatMap(from => ["json", "plain", "html5", "rst", "gfm", "latex", "rtf", "odt"].map(to => ({mode, from, to, ...ordinary, byteQuota: true})))));
cases.push(...modes.flatMap(mode => ["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"].map(to => ({mode, from: "rtf", to, ...ordinary, byteQuota: true}))));
cases.push(...modes.flatMap(mode => ["json", "html5"].map(to => ({mode, from: "json", to, ...ordinary, transform: true, byteQuota: true}))));
cases.push(...modes.map(mode => ({mode, from: "json", to: "json", ...ordinary, metadata: true, byteQuota: true})));
cases.push(...modes.map(mode => ({mode, from: "json", to: "html5", ...ordinary, template: true, byteQuota: true})));
for (const option of ["filter", "lua"] as const)
  cases.push(...modes.map(mode => ({mode, from: "json", to: "json", ...ordinary, [option]: true, byteQuota: true})));
cases.push(...modes.map(mode => ({mode, from: "mediawiki", to: "plain", ...ordinary, byteQuota: true})));
for (const option of ["filter", "lua"] as const)
  cases.push(...modes.map(mode => ({mode, from: "mediawiki", to: "plain", ...ordinary, [option]: true, byteQuota: true})));
cases.push(...modes.map(mode => ({mode, from: "mediawiki", to: "plain", ...ordinary, byteQuota: true, joined: true})));
cases.push(...modes.flatMap(mode => ["none", "lua", "json"].map(filter => ({mode, from: "mediawiki", to: "plain", ...ordinary, byteQuota: true, joined: true, fileScope: true, lua: filter === "lua", filter: filter === "json"}))));
it.each(cases)("retains finite $from-to-$to reference budgets through the public $mode in workerd with transforms=$transform metadata=$metadata filter=$filter lua=$lua template=$template crlf=$crlf writerOptions=$writerOptions byteQuota=$byteQuota joined=$joined fileScope=$fileScope", async ({mode, from, to, transform, metadata, filter, lua, template, crlf, writerOptions, byteQuota, joined, fileScope}) => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput, createJsonFilterCapability, createLuaFilterCapability} from "./packages/safe-bash-command-pandoc/dist/index.js";
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
      const value = 'x'.repeat(${mode === 'command' || lua ? 600000 : 17000});
      const json = JSON.stringify({'pandoc-api-version': [1,23,1,2], meta: {}, blocks: [{t: 'Para', c: [{t: 'Str', c: value}]}]});
      const transform = ${transform}, metadata = ${metadata}, filter = ${filter}, lua = ${lua}, template = ${template}, crlf = ${crlf}, writerOptions = ${writerOptions};
      const templateFiles = {"/template": "$if(show)$$header-includes$$body$$endif$", "/header": "header", "/before": "before", "/after": "after"};
      if (template) for (const [path, value] of Object.entries(templateFiles)) {await namespace.writeFile(path, new Uint8Array()); await env.PAGES.put(path, value);}
      if (lua) {await namespace.writeFile("/filter.lua", new Uint8Array()); await env.PAGES.put("/filter.lua", "function Str(el) return el end");}
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
      const limits = {...(${byteQuota} ? {retainedBytes: (from === "csv" || from === "tsv" || writerOptions || ${joined}) ? 64000000 : 32000000} : {}), references: (crlf || to === 'latex' || to === 'rtf') ? 2000000 : 10000, text: (metadata || filter || lua || ${joined}) ? 6000000 : transform ? 4000000 : 2000000, nodes: 1000, depth: 64};
      if (${JSON.stringify(mode)} === 'sdk') {
        await api.convertToOutput([{chunks: fs.readStream('/input.json')}, ...(${joined} ? [{chunks: fs.readStream('/input.json')}] : [])], {from, to, fileScope: ${fileScope}, ...(writerOptions ? {standalone: true, ...(to === "gfm" ? {toc: true, ascii: true, wrap: "auto", columns: 12, rawContent: "retain"} : {})} : {}), ...(crlf ? {eol: "crlf", standalone: false} : {}), ...(template ? {template: {chunks: fs.readStream("/template")}, variables: {show: "yes"}, includeInHeader: [{chunks: fs.readStream("/header")}], includeBeforeBody: [{chunks: fs.readStream("/before")}], includeAfterBody: [{chunks: fs.readStream("/after")}]} : {}), ...(filter || lua ? {filters: [{kind: lua ? "lua" : "json", path: lua ? "/filter.lua" : "/filter"}]} : {}), ...(metadata ? {metadataJson: [{title: value}]} : {}), ...(transform ? {stripComments: true, shiftHeadingLevelBy: -1} : {})}, {limits, ...(lua ? {filters: api.createLuaFilterCapability({readStream: () => fs.readStream("/filter.lua")})} : {}), ...(filter ? {filters: api.createJsonFilterCapability({async runStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes); return 0;}})} : {}), workingFiles: {fs, directory: '/spill', cacheBytes: lua ? 1048576 : 16384}, output});
      } else {
        const result = await api.createPandocCommand({limits, ...(lua ? {filters: api.createLuaFilterCapability({readStream: () => fs.readStream("/filter.lua")})} : {}), ...(filter ? {jsonFilterCommand: "filter-runtime"} : {})}).execute({command: 'pandoc', args: ['-f' + from, '-t' + to, ...(${fileScope} ? ['--file-scope'] : []), ...(writerOptions ? ['--standalone', ...(to === 'gfm' ? ['--toc', '--ascii', '--wrap', 'auto', '--columns', '12', '--raw-content', 'retain'] : [])] : []), ...(crlf ? ['--eol', 'crlf'] : []), ...(template ? ['--template', '/template', '--variable', 'show=yes', '--include-in-header', '/header', '--include-before-body', '/before', '--include-after-body', '/after'] : []), ...(lua ? ['--lua-filter', '/filter.lua'] : []), ...(filter ? ['--filter', '/filter'] : []), ...(metadata ? ['--metadata', 'title=' + value] : []), ...(transform ? ['--strip-comments', '--shift-heading-level-by=-1'] : []), '/input.json', ...(${joined} ? ['/input.json'] : [])], async invoke(name, args, streams) {if (name !== 'filter-runtime' || args[1] !== '/filter') throw new Error('Wrong filter invocation'); for await (const bytes of streams.stdin) await streams.stdout.write(bytes); return {exitCode: 0};}, cwd: '/', env: {TMPDIR: '/spill'}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: output, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
        if (result.exitCode !== 0) throw new Error('Command failed'); closed++;
      }
      await env.PAGES.delete('/input.json');
      if (lua) await env.PAGES.delete('/filter.lua');
      if (template) for (const path of Object.keys(templateFiles)) await env.PAGES.delete(path);
      const matches = template ? text === 'headerbefore<p>' + value + '</p>\\nafter' : to === 'odt' ? text.startsWith('PK') && text.includes(value) : to === 'rtf' ? text.startsWith('{\\\\rtf1') && text.includes(value) : to === 'latex' ? (from === 'json' || from === 'rtf' ? text === value + '\\n' : text.startsWith('\\\\begin{longtable}') && text.includes(value)) : to === 'gfm' ? (from === 'json' || from === 'rtf' ? text === value + '\\n' : text === '| ' + value + ' |\\n| --- |\\n') : to === 'commonmark' ? text === value + '\\n' : to === 'rst' ? (from === 'json' || from === 'rtf' ? text === value + '\\n' : text.startsWith('.. list-table::') && text.includes(value)) : to === 'html5' ? (from === 'json' || from === 'rtf' ? text === '<p>' + value + '</p>\\n' : text.includes('>' + value + '</th>')) : to === 'plain' ? text === value + '\\n' + (${joined} ? '\\n' + value + '\\n' : '') : from === 'json' || from === 'rtf' ? text === (metadata ? JSON.stringify({...JSON.parse(json), meta: {title: {t: 'MetaString', c: value}}}) : json) + (crlf ? '\\r\\n' : '\\n') : JSON.parse(text).blocks[0].c[3][1][0][1][0][4][0].c[0].c === value;
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
