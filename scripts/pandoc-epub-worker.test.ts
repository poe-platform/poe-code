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

it.each(["sdk", "command"])("retains EPUB XML, chapter/note ASTs, manifest records and fallback membership and resolves long chapter URIs through the public %s in workerd", async mode => {
  const bundle = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export {convertToOutput} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {createPandocCommand} from "./packages/safe-bash-command-pandoc/dist/command.js";
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
      const files = {
        mimetype: 'application/epub+zip',
        'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'package.opf': '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
        'chapter.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head><body><p id="book"><a href="' + 'unused/../'.repeat(2048) + 'chapter.xhtml#book">Book.</a></p></body></html>',
        'unused.bin': 'x'.repeat(32768)
      };
      files['chapter.xhtml'] = files['chapter.xhtml'].replace('</body>', Array.from({length: 96}, (_, i) => '<span id="anchor-' + i + '"></span>').join('') + '</body>');
      const fallbacks = Array.from({length: 96}, (_, index) => '<item id="fallback-id-' + index + '" href="unused-' + index + '.bin" media-type="application/octet-stream" fallback="' + (index < 95 ? 'fallback-id-' + (index + 1) : 'chapter') + '"/>').join('');
      files['package.opf'] = files['package.opf'].replace('<manifest>', '<manifest>' + fallbacks);
      files['chapter.xhtml'] = files['chapter.xhtml'].replace('<html ', '<html xmlns:epub="http://www.idpf.org/2007/ops" ').replace('</body>', '<p><a epub:type="noteref" href="notes.xhtml#note">1</a></p></body>');
      files['notes.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><aside id="note" epub:type="footnote"><p>External note.</p></aside></body></html>';
      files['package.opf'] = files['package.opf'].replace('</manifest>', '<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest>');
      const entries = [];
      for (const [name, value] of Object.entries(files)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(value), {modified: new Date('1980-01-01T00:00:00Z'), mode: 0o100644, directory: false, symlink: false, compression: 'store'}, limits, signal));
      await env.PAGES.put('/input.epub', await zip.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal));
      const namespace = new api.MemoryFileSystem(); await namespace.mkdir('/spill'); await namespace.writeFile('/input.epub', new Uint8Array());
      const {fs: backing, events} = api.createR2PagedFixture(namespace, env.PAGES);
      const fs = new Proxy(backing, {get(target, key) {
        if (key === 'readFile') return async () => {throw new Error('Whole file forbidden');};
        if (key === 'readStream') return async function* (path) {const object = await env.PAGES.get(path); yield* object.body;};
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      }});
      const originalPush = Array.prototype.push;
      Array.prototype.push = function(...values) {if (values.some(value => value && typeof value === 'object' && typeof value.name === 'string' && typeof value.uri === 'string' && Array.isArray(value.children))) throw new Error('Resident EPUB XML forbidden'); return originalPush.apply(this, values);};
      const originalMapSet = Map.prototype.set;
      Map.prototype.set = function(key, value) {if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.startsWith('fallback-id-')) throw new Error('Resident manifest record forbidden'); return originalMapSet.call(this, key, value);};
      const originalAdd = Set.prototype.add;
      Set.prototype.add = function(value) {if (typeof value === 'string' && (value.startsWith('fallback-id-') || value.startsWith('chapter.xhtml#'))) throw new Error('Resident fallback membership forbidden'); return originalAdd.call(this, value);};
      const originalSplit = String.prototype.split;
      String.prototype.split = function(...args) {if (String(this).includes('unused/../')) throw new Error('Whole URI component array forbidden'); return originalSplit.apply(this, args);};
      let output = '', errors = '', result;
      const stdout = {async write(bytes) {await Promise.resolve(); output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}};
      try {
        if (${JSON.stringify(mode)} === 'sdk') await api.convertToOutput([{chunks: fs.readStream('/input.epub')}], {from: 'epub', to: 'plain'}, {workingFiles: {fs, directory: '/spill', cacheBytes: 16384}, output: stdout});
        else {
          result = await api.createPandocCommand().execute({command: 'pandoc', args: ['-f', 'epub', '-t', 'plain', '/input.epub'], cwd: '/', env: {TMPDIR: '/spill'}, fs, signal, stdin: (async function* () {})(), stdout, stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}});
        }
      } finally {String.prototype.split = originalSplit; Set.prototype.add = originalAdd; Map.prototype.set = originalMapSet; Array.prototype.push = originalPush;}
      await env.PAGES.delete('/input.epub');
      return Response.json({output, errors, exitCode: result?.exitCode ?? 0, events,
        remaining: (await env.PAGES.list({limit: 1})).objects.length, namespace: await namespace.readdir('/spill')});
    }};
  `});
  try {
    const response = await runtime.dispatchFetch("https://epub.test/");
    expect(response.status, response.status === 200 ? undefined : await response.text()).toBe(200);
    const result = await response.json() as {output: string; events: {opened: number; closed: number; largestTransfer: number}};
    expect(result).toMatchObject({errors: "", exitCode: 0, remaining: 0, namespace: []});
    expect(result.output).toContain("Book."); expect(result.output).toContain("External note.");
    if (mode === "sdk") expect(result.events.opened).toBeGreaterThan(0);
    expect(result.events.closed).toBe(result.events.opened); expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
  } finally {await runtime.dispose();}
}, 60000);
