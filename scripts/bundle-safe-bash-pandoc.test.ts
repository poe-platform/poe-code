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
beforeAll(async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const options = resolveBrowserShellBuild(root);
  result = await build({
    ...options, entryPoints: undefined, splitting: false, sourcemap: false,
    format: "cjs", logLevel: "silent",
    stdin: {
      contents: 'export { createLuaFilterCapability } from "safe-bash-command-pandoc/lua-filters"; export { createPandocCommand } from "safe-bash-command-pandoc/command";',
      resolveDir: path.join(root, "packages/safe-bash")
    }
  });
});

it("uses prepared Pandoc adapters in the standalone browser shell build", async () => {
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.map(entry => entry.path))]).toEqual(["poe-code/safe-fs/core"]);
  const module = { exports: {} as {
    createLuaFilterCapability: (load: () => Promise<Uint8Array>) => FilterCapability;
    createPandocCommand: () => { name: string };
  } };
  runInNewContext(result.outputFiles![0]!.text, {
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
      const pandoc = (() => {
        const module = { exports: {} };
        const require = name => {
          if (name !== "poe-code/safe-fs/core") throw new Error("Unexpected external: " + name);
          return fs;
        };
        ${result.outputFiles![0]!.text};
        return module.exports;
      })();
      export default { async fetch() {
        let stdout = "", stderr = "";
        const command = pandoc.createPandocCommand();
        const outcome = await command.execute({
          command: "pandoc", args: ["-f", "markdown", "-t", "html"], cwd: "/", env: {},
          fs: fs.createMemoryFileSystem(), signal: new AbortController().signal,
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
  } finally {
    await runtime.dispose();
  }
});
