import path from "node:path";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { build, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { Volume } from "memfs";
import { resolveBrowserShellBuild, resolveBrowserYqBuild } from "./bundle-safe-bash.mjs";

const root = process.cwd();
const artifacts = new Volume();
let yq: BuildResult;

beforeAll(async () => {
  yq = await build({ ...resolveBrowserYqBuild(root), sourcemap: false });
  for (const output of yq.outputFiles!) {
    artifacts.mkdirSync(path.dirname(output.path), { recursive: true });
    artifacts.writeFileSync(output.path, output.contents);
  }
});

it.each(["browser", "workerd"])("runs public optional YQ staged writes without Node globals under %s", async condition => {
  const manifest = JSON.parse(await readFile(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  const options = resolveBrowserShellBuild(root);
  const consumer = await build({
    ...options, entryPoints: undefined, outdir: undefined, sourcemap: false, splitting: false,
    conditions: [condition], external: [], format: "cjs",
    alias: { ...options.alias,
      "@poe-code/safe-fs": path.join(root, "packages/safe-fs/src/core.ts"),
      "@poe-code/safe-fs/core": path.join(root, "packages/safe-fs/src/core.ts"),
      "poe-code/safe-fs/core": path.join(root, "packages/safe-fs/src/core.ts"),
    },
    stdin: { resolveDir: root, contents: `
      import { Shell, createMemoryFileSystem } from "./packages/safe-bash/src/core.browser.ts";
      import { yqCommands } from "@poe-platform/safe-bash/yq";
      export async function run() {
        const fs = createMemoryFileSystem();
        await fs.writeFile("/input.yml", new TextEncoder().encode("a: 1\\n"));
        const shell = new Shell({ fs }).use(yqCommands());
        try {
          const result = await shell.exec("yq -i '.a = 2' /input.yml");
          return { result, text: new TextDecoder().decode(await fs.readFile("/input.yml")), nodeGlobals: "Buffer" in globalThis || "process" in globalThis };
        } finally { await shell.dispose(); }
      }
    ` },
    plugins: [...options.plugins, {
      name: "public-optional-yq",
      setup(builder) {
        builder.onResolve({ filter: /^@poe-platform\/safe-bash\/yq$/ }, () => ({
          path: path.join(root, "packages/safe-bash", manifest.exports["./yq"][condition]), namespace: "built-yq",
        }));
        builder.onResolve({ filter: /^\./, namespace: "built-yq" }, args => ({
          path: path.resolve(path.dirname(args.importer), args.path), namespace: "built-yq",
        }));
        builder.onResolve({ filter: /^[^./]/, namespace: "built-yq" }, args =>
          builder.resolve(args.path, { resolveDir: root, kind: args.kind }));
        builder.onLoad({ filter: /.*/, namespace: "built-yq" }, args => ({
          contents: artifacts.readFileSync(args.path, "utf8").toString(), loader: "js", resolveDir: path.dirname(args.path),
        }));
      },
    }],
  });
  const sandbox = createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream,
    ReadableStream, WritableStream, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask,
    crypto: globalThis.crypto, performance });
  const api = runInContext(`(function(){const module={exports:{}};${consumer.outputFiles![0]!.text};return module.exports;})()`, sandbox);
  const result = await api.run();
  expect(result.result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
  expect(result.text).toBe("a: 2\n");
  expect(result.nodeGlobals).toBe(false);
});
