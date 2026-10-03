import path from "node:path";
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
  const published = await build({
    entryPoints: [path.join(root, "packages/safe-bash/dist/commands/pandoc/index.browser.js")],
    bundle: true, platform: "browser", format: "cjs", write: false, metafile: true,
    logLevel: "silent", external: ["poe-code/safe-fs/core"], loader: {".wasm": "copy"},
    outdir: path.join(root, "out/pandoc-qualification"),
  });
  expect([...new Set(Object.values(published.metafile!.outputs).flatMap(output =>
    output.imports.filter(entry => entry.external).map(entry => entry.path)
  ))]).toEqual(["poe-code/safe-fs/core"]);
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

it("loads the Pandoc bundle and converts Markdown in workerd without Node compatibility", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fsBuild = await build({
    entryPoints: [path.join(root, "packages/safe-fs/src/core.ts")],
    bundle: true, platform: "browser", format: "cjs", write: false,
  });
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-07-01", cf: false,
    script: `
      const fs = (() => { const module = { exports: {} }; ${fsBuild.outputFiles[0]!.text}; return module.exports; })();
      const pandoc = ((require) => {
        const module = { exports: {} };
        ${publishedScript};
        return module.exports;
      })(name => {
        if (name !== "poe-code/safe-fs/core") throw new Error("Unexpected external: " + name);
        return fs;
      });
      export default { async fetch(request) {
        const scenario = new URL(request.url).pathname.slice(1);
        const vfs = fs.createMemoryFileSystem();
        const encoder = new TextEncoder();
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
          const result = await pandoc.convert([{bytes: await vfs.readFile("/input.md")}], {
            from: "markdown", to: "html", filters: [{kind: "lua", path: "/filter.lua"}],
          }, {filters: pandoc.createLuaFilterCapability({readFile: (path, signal) => vfs.readFile(path, {signal})})});
          return Response.json({exitCode: 0, stdout: result.text, stderr: ""});
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
    for (const [scenario, code, status] of [["host", "E_AST", 4], ["syntax", "E_AST", 4], ["missing", "E_IO", 9], ["budget", "E_LIMIT", 7]]) {
      const failed = await runtime.dispatchFetch("https://pandoc.test/" + scenario);
      expect(await failed.json()).toEqual({exitCode: status, stdout: "", stderr: expect.stringContaining(code)});
    }
  } finally {
    await runtime.dispose();
  }
});
