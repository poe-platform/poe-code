import path from "node:path";
import {readFile} from "node:fs/promises";
import {encodePngImage} from "../packages/image-ast/src/codecs/png.js";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build, type BuildResult } from "esbuild";
import { Miniflare } from "miniflare";
import { beforeAll, expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import type { Document, FilterCapability } from "../packages/safe-bash-command-pandoc/src/types.js";
import { ExecutionContext } from "../packages/safe-bash-command-pandoc/src/execution.js";
import * as filesystem from "../packages/safe-fs/src/core.js";

let result: BuildResult;
let script: string;
let publishedScript: string;
beforeAll(async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const options = resolveBrowserShellBuild(root);
  result = await build({
    ...options, entryPoints: undefined, splitting: false, sourcemap: false,
    format: "cjs", logLevel: "silent",
    stdin: {
      contents: 'export * from "./src/commands/pandoc/index.js";',
      resolveDir: path.join(root, "packages/safe-bash")
    }
  });
  script = result.outputFiles!.find(file => file.path.endsWith(".js"))!.text;
  const packageRoot = path.join(root, "packages/safe-bash");
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const published = await build({
    stdin: {resolveDir: packageRoot, contents: [
      `export * from "${manifest.exports["./commands/pandoc"].workerd}";`,
      `export {createSipsCommand} from "${manifest.exports["./commands/sips"].workerd}";`,
      `export {createShufCommand} from "${manifest.exports["./commands/shuf"].workerd}";`,
    ].join("\n")},
    bundle: true, platform: "browser", format: "cjs", write: false, metafile: true,
    logLevel: "silent", external: ["poe-code/safe-fs/core", "@poe-platform/safe-fs/core"], loader: {".wasm": "copy"},
    outdir: path.join(root, "out/pandoc-qualification"),
  });
  expect([...new Set(Object.values(published.metafile!.outputs).flatMap(output =>
    output.imports.filter(entry => entry.external).map(entry => entry.path)
  ))].sort()).toEqual(["@poe-platform/safe-fs/core", "poe-code/safe-fs/core"]);
  publishedScript = published.outputFiles!.find(file => file.path.endsWith(".js"))!.text;
});

it("uses prepared Pandoc adapters in the standalone browser shell build", async () => {
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.filter(entry => entry.external).map(entry => entry.path))]).toEqual(["poe-code/safe-fs/core"]);
  const module = { exports: {} as {
    createLuaFilterCapability: (load: () => Promise<Uint8Array>) => FilterCapability;
    createPandocCommand: () => { name: string };
  } };
  runInNewContext(script, {
    module, Uint8Array, TextEncoder, TextDecoder, AbortController, AbortSignal,
    require(name: string) {
      expect(name).toBe("poe-code/safe-fs/core");
      return filesystem;
    }
  }, { contextCodeGeneration: { strings: false, wasm: false } });
  expect(module.exports.createPandocCommand().name).toBe("pandoc");
  const filter = module.exports.createLuaFilterCapability(async () => new TextEncoder().encode(
    'function Str(el) el.text = string.upper(el.text); return el end'
  ));
  const document: Document = { metadata: {}, resources: [], blocks: [{ t: "Para", c: [{ t: "Str", c: "Hello" }] }] };
  const filtered = await filter.apply(document, { kind: "lua", path: "filter.lua" },
    Object.assign(new ExecutionContext("convert", {}), { to: "html" }));
  expect(filtered.blocks).toEqual([{ t: "Para", c: [{ t: "Str", c: "HELLO" }] }]);
});

it("runs composed Sips, Shuf and streamed Pandoc public bundles in workerd without Node compatibility", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fsBuild = await build({
    entryPoints: [path.join(root, "packages/safe-fs/src/core.ts")],
    bundle: true, platform: "browser", format: "cjs", write: false,
  });
  const png = encodePngImage({width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true});
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-07-01", cf: false,
    script: `
      const fs = (() => { const module = { exports: {} }; ${fsBuild.outputFiles[0]!.text}; return module.exports; })();
      const pandoc = ((require) => {
        const module = { exports: {} };
        ${publishedScript};
        return module.exports;
      })(name => {
        if (name !== "poe-code/safe-fs/core" && name !== "@poe-platform/safe-fs/core") throw new Error("Unexpected external: " + name);
        return fs;
      });
      export default { async fetch(request) {
        const scenario = new URL(request.url).pathname.slice(1);
        const vfs = fs.createMemoryFileSystem();
        const encoder = new TextEncoder();
        if (scenario !== "composed" && scenario !== "tables") vfs.readFile = () => {
          throw new Error("Document and filter files must stream");
        };
        await vfs.writeFile("/input.md", encoder.encode("**portable**"));
        const scripts = {
          lua: 'assert(io == nil and os == nil and package == nil and require == nil and dofile == nil and loadfile == nil); local xs = {3, 1, 2}; table.sort(xs); assert(table.concat(xs) == "123"); function Str(el) el.text = string.upper(el.text); return el end',
          missing: undefined,
          host: 'return dofile("/etc/passwd")',
          syntax: 'function Str(',
          budget: 'while true do end',
        };
        if (scripts[scenario]) await vfs.writeFile("/filter.lua", encoder.encode(scripts[scenario]));
        if (scenario === "sdk") {
          await vfs.writeFile("/filter.lua", encoder.encode(scripts.lua));
          const result = await pandoc.convert([{chunks: vfs.readStream("/input.md", {chunkSize: 3})}], {
            from: "markdown", to: "html", filters: [{kind: "lua", path: "/filter.lua"}],
          }, {filters: pandoc.createLuaFilterCapability({readStream: (path, signal) => vfs.readStream(path, {signal, chunkSize: 3})})});
          return Response.json({exitCode: 0, stdout: result.text, stderr: ""});
        }
        if (scenario === "composed") {
          const outputs = [];
          const execute = async (command, args) => {
            let stdout = "", stderr = "";
            const result = await command.execute({command: command.name, args, cwd: "/", env: {}, fs: vfs,
              signal: new AbortController().signal, stdin: (async function* () {})(),
              stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
              stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}},
            });
            outputs.push({exitCode: result.exitCode, stdout, stderr});
            if (result.exitCode) throw new Error(stderr);
          };
          await vfs.writeFile("/image.png", Uint8Array.from(${JSON.stringify([...png])}));
          await execute(pandoc.createSipsCommand(), ["-s", "description", "shared-vfs", "/image.png", "-o", "/copy.png"]);
          await execute(pandoc.createSipsCommand(), ["-g", "description", "/copy.png"]);
          await vfs.writeFile("/words", encoder.encode("hello\\nworld\\n"));
          await execute(pandoc.createShufCommand(), ["/words", "-o", "/words.md"]);
          await vfs.writeFile("/filter.lua", encoder.encode(scripts.lua));
          await execute(pandoc.createPandocCommand(), ["-f", "commonmark", "-t", "html", "-L", "/filter.lua", "/words.md"]);
          return Response.json(outputs);
        }
        if (scenario === "tables") {
          await vfs.mkdir("/spill");
          await vfs.writeFile("/table.csv", encoder.encode("header\\n" + "x".repeat(1100000)));
          const results = [];
          for (const mode of ["sdk", "command", "sdk-file", "command-file"]) {
            let opened = 0, bytesWritten = 0, largestWrite = 0, hash = 2166136261, stderr = "";
            const supplied = new Proxy(vfs, {get(target, key) {
              if (key === "readFile") return () => {throw new Error("Whole-file table reads are forbidden");};
              if (key === "capabilities") return {...target.capabilities, atomicFilePublication: true};
              if (key === "capabilitiesFor") return undefined;
              if (key === "publishFileConditional") return async (path, source, options) => {
                if (path !== "/result.html" || options.expected !== null) throw new Error("Unexpected file publication");
                for await (const bytes of source) await output.write(bytes);
                return {...await target.stat("/"), type: "file", size: bytesWritten};
              };
              if (key === "open") return (path, options) => {
                if (!path.startsWith("/spill/.storage-")) throw new Error("Backing storage escaped the supplied directory");
                opened++;
                return target.open(path, options);
              };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            }});
            const output = {async write(bytes) {
              bytesWritten += bytes.length;
              largestWrite = Math.max(largestWrite, bytes.length);
              for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            }, async close() {}, async abort() {}};
            let exitCode = 0;
            const sink = mode === "sdk-file" ? pandoc.createFileOutput(supplied, "/result.html", {
              expected: null, parent: await supplied.stat("/"), maxBytes: Infinity
            }) : output;
            if (mode === "sdk" || mode === "sdk-file") await pandoc.convertToOutput([{chunks: supplied.readStream("/table.csv", {chunkSize: 16384})}],
              {from: "csv", to: "html"}, {workingFiles: {fs: supplied, directory: "/spill", cacheBytes: 16384}, output: sink});
            else {
              const result = await pandoc.createPandocCommand().execute({
                command: "pandoc", args: ["-f", "csv", "-t", "html", "/table.csv", ...(mode === "command-file" ? ["-o", "/result.html"] : [])],
                fs: supplied, cwd: "/", env: {TMPDIR: "/spill"}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: output,
                stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
              });
              exitCode = result.exitCode;
            }
            results.push({mode, opened, bytesWritten, largestWrite, hash, exitCode, stderr, remaining: await vfs.readdir("/spill")});
          }
          return Response.json(results);
        }
        let stdout = "", stderr = "";
        const command = pandoc.createPandocCommand(scenario === "budget" ? {limits: {work: 10000}} : {});
        const outcome = await command.execute({
          command: "pandoc", args: ["-f", "markdown", "-t", "html", ...(scenario ? ["--lua-filter", "/filter.lua", "/input.md"] : [])], cwd: "/", env: {},
          fs: vfs, signal: new AbortController().signal,
          stdin: (async function* () { yield new TextEncoder().encode("**portable**"); })(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        return Response.json({ exitCode: outcome.exitCode, stdout, stderr });
      } };
    `,
  });
  try {
    const response = await runtime.dispatchFetch("https://pandoc.test");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exitCode: 0, stdout: "<p><strong>portable</strong></p>\n", stderr: "" });
    for (const scenario of ["lua", "sdk"]) {
      const filtered = await runtime.dispatchFetch("https://pandoc.test/" + scenario);
      expect(await filtered.json()).toEqual({exitCode: 0, stdout: "<p><strong>PORTABLE</strong></p>\n", stderr: ""});
    }
    const tablesResponse = await runtime.dispatchFetch("https://pandoc.test/tables");
    const tablesText = await tablesResponse.text();
    expect(tablesResponse.status, tablesText).toBe(200);
    const expectedTable = new TextEncoder().encode('<table>\n<colgroup><col></colgroup>\n<thead>\n<tr><th scope="col">header</th></tr>\n</thead>\n<tbody>\n<tr><td>' + "x".repeat(1100000) + '</td></tr>\n</tbody>\n</table>\n');
    let expectedHash = 2166136261;
    for (const byte of expectedTable) expectedHash = Math.imul(expectedHash ^ byte, 16777619) >>> 0;
    const tables = JSON.parse(tablesText) as {mode: string; opened: number; bytesWritten: number; largestWrite: number; hash: number; exitCode: number; stderr: string; remaining: unknown[]}[];
    expect(tables.map(table => table.mode)).toEqual(["sdk", "command", "sdk-file", "command-file"]);
    for (const table of tables) {
      expect(table).toMatchObject({bytesWritten: expectedTable.length, hash: expectedHash, exitCode: 0, stderr: "", remaining: []});
      expect(table.opened).toBeGreaterThan(0);
      expect(table.largestWrite).toBeLessThanOrEqual(16384);
    }
    const composedResponse = await runtime.dispatchFetch("https://pandoc.test/composed");
    const composedText = await composedResponse.text();
    expect(composedResponse.status, composedText).toBe(200);
    const composed = JSON.parse(composedText) as {exitCode: number; stdout: string; stderr: string}[];
    expect(composed.every(result => result.exitCode === 0 && result.stderr === "")).toBe(true);
    expect(composed[1]!.stdout).toContain("description: shared-vfs");
    expect(composed[3]!.stdout).toMatch(/^<p>(HELLO\nWORLD|WORLD\nHELLO)<\/p>\n$/);
    for (const [scenario, code, status] of [["host", "E_AST", 4], ["syntax", "E_AST", 4], ["missing", "E_IO", 9], ["budget", "E_LIMIT", 7]]) {
      const failed = await runtime.dispatchFetch("https://pandoc.test/" + scenario);
      expect(await failed.json()).toEqual({exitCode: status, stdout: "", stderr: expect.stringContaining(code)});
    }
  } finally {
    await runtime.dispose();
  }
});
