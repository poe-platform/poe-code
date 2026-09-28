import path from "node:path";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { build, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { Volume } from "memfs";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

const root = process.cwd();
const artifacts = new Volume();
let published: BuildResult;

beforeAll(async () => {
  published = await build({ ...resolveBrowserShellBuild(root), sourcemap: false });
  for (const output of published.outputFiles!) {
    artifacts.mkdirSync(path.dirname(output.path), { recursive: true });
    artifacts.writeFileSync(output.path, output.contents);
  }
});

it("ships the portable graph without bare private contract imports", () => {
  const imports = Object.values(published.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.filter(item => item.external && item.path.startsWith("safe-bash-contracts"))).toEqual([]);
});

it.each(["browser", "workerd"])("runs public optional YQ staged writes with portable Buffer under %s", async condition => {
  const manifest = JSON.parse(await readFile(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  const consumer = await build({
    bundle: true, write: false, platform: "browser", target: "es2022",
    loader: { ".wasm": "binary" },
    conditions: [condition], format: "cjs",
    stdin: { resolveDir: root, contents: `
      import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
      import { yqCommands } from "@poe-platform/safe-bash/yq";
      export async function run() {
        const fs = createMemoryFileSystem();
        await fs.writeFile("/input.yml", new TextEncoder().encode("a: 1\\n"));
        const shell = new Shell({ fs }).use(yqCommands());
        try {
          const result = await shell.exec("yq -i '.a = 2' /input.yml");
          return { result, text: new TextDecoder().decode(await fs.readFile("/input.yml")),
            nodeGlobals: "process" in globalThis || "require" in globalThis,
            portableBytes: globalThis.Buffer.from("é").toString("hex") };
        } finally { await shell.dispose(); }
      }
    ` },
    plugins: [{
      name: "public-optional-yq",
      setup(builder) {
        builder.onResolve({ filter: /^@poe-platform\/safe-bash(?:\/yq)?$/ }, args => ({
          path: path.join(root, "packages/safe-bash", manifest.exports[args.path.endsWith("/yq") ? "./yq" : "."][condition]), namespace: "built-yq",
        }));
        builder.onResolve({ filter: /^poe-code\/safe-fs\/core$/ }, () => ({ path: path.join(root, "packages/safe-fs/src/core.ts") }));
        builder.onResolve({ filter: /^\./, namespace: "built-yq" }, args => ({
          path: path.resolve(path.dirname(args.importer), args.path), namespace: "built-yq",
        }));
        builder.onResolve({ filter: /^[^./]/, namespace: "built-yq" }, args =>
          builder.resolve(args.path, { resolveDir: root, kind: args.kind }));
        builder.onLoad({ filter: /.*/, namespace: "built-yq" }, args => ({
          contents: args.path.endsWith(".wasm")
            ? `export default new WebAssembly.Module(Uint8Array.from(${JSON.stringify([...artifacts.readFileSync(args.path) as Uint8Array])}));`
            : artifacts.readFileSync(args.path, "utf8").toString(), loader: "js", resolveDir: path.dirname(args.path),
        }));
      },
    }],
  });
  const sandbox = createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream,
    ReadableStream, WritableStream, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask,
    crypto: globalThis.crypto, performance });
  expect(runInContext("typeof Buffer", sandbox)).toBe("undefined");
  const api = runInContext(`(function(){const module={exports:{}};${consumer.outputFiles![0]!.text};return module.exports;})()`, sandbox);
  const result = await api.run();
  expect(result.result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
  expect(result.text).toBe("a: 2\n");
  expect(result.nodeGlobals).toBe(false);
  expect(result.portableBytes).toBe("c3a9");
});
