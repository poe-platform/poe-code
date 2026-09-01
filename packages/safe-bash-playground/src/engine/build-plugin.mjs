import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentRootState } from "./root-state-adapter.mjs";
import { limitCommandBuffers } from "./buffer-limit-adapter.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export async function buildBrowserEngine(options = {}) {
  const installed = require.resolve
    .paths("safe-bash-engine")
    .find((path) => existsSync(resolve(path, "safe-bash-engine/package.json")));
  if (!options.engineRoot && !installed)
    throw new Error("Install the pinned safe-bash-engine devDependency before building");
  const engineRoot = options.engineRoot ?? resolve(installed, "safe-bash-engine");
  const manifest = JSON.parse(await readFile(resolve(engineRoot, "package.json"), "utf8"));
  if (manifest.name !== "poe-code" || manifest.version !== "14.0.4") {
    throw new Error(
      "Browser adapters require the pinned safe-bash-engine alias: npm:poe-code@14.0.4"
    );
  }
  const bash = resolve(engineRoot, "packages/safe-bash/dist");
  const filesystem = resolve(engineRoot, "packages/safe-js/dist/browser/safe-fs.js");
  const result = await build({
    ...(options.kernelOnly
      ? { stdin: { contents: 'export * from "virtual:safe-bash-kernel";', resolveDir: directory } }
      : { entryPoints: [resolve(directory, "index.ts")] }),
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: options.minify ?? false,
    metafile: true,
    inject: [resolve(directory, "platform.ts")],
    plugins: [
      {
        name: "safe-bash-explicit-browser-platform",
        setup(builder) {
          builder.onLoad({ filter: /\/commands\/internal\.js$/ }, async (args) => ({
            contents: limitCommandBuffers(await readFile(args.path, "utf8")),
            resolveDir: dirname(args.path)
          }));
          builder.onLoad({ filter: /\/shell\/shell\.js$/ }, async (args) => ({
            contents: instrumentRootState(await readFile(args.path, "utf8")),
            resolveDir: dirname(args.path)
          }));
          builder.onResolve({ filter: /^virtual:safe-bash-kernel$/ }, () => ({
            path: "kernel",
            namespace: "safe-bash-browser"
          }));
          builder.onLoad({ filter: /^kernel$/, namespace: "safe-bash-browser" }, () => ({
            contents: [
              `export { Shell } from ${JSON.stringify(resolve(bash, "shell/index.js"))};`,
              `export { createMemoryFileSystem, resolvePath, normalizePath, readBytes, FsError } from ${JSON.stringify(filesystem)};`,
              ...["basic", "filesystem", "predicates", "streams", "text"].map(
                (family) =>
                  `export * from ${JSON.stringify(resolve(bash, `commands/${family}.js`))};`
              )
            ].join("\n"),
            resolveDir: directory
          }));
          builder.onResolve({ filter: /^poe-code\/safe-fs$/ }, () => ({
            path: "filesystem",
            namespace: "safe-bash-browser"
          }));
          builder.onLoad({ filter: /^filesystem$/, namespace: "safe-bash-browser" }, () => ({
            contents: `export * from ${JSON.stringify(filesystem)}; export * from ${JSON.stringify(resolve(directory, "path.ts"))};`,
            resolveDir: directory
          }));
          builder.onLoad(
            { filter: /\/commands\/regex-execution\/ere\/transport\/root\.js$/ },
            (args) => ({
              contents: `import { EreUnsupportedError } from "../errors.js"; export class EreTransportRoot { constructor() { throw new EreUnsupportedError("[[ =~ ]] is unavailable in this browser", 0); } }`,
              resolveDir: dirname(args.path)
            })
          );
          builder.onResolve({ filter: /^node:/ }, (args) => {
            if (args.path === "node:stream/web") return { path: resolve(directory, "platform.ts") };
            throw new Error(
              `Unsupported Node capability in browser engine: ${args.path} from ${args.importer}`
            );
          });
        }
      }
    ]
  });
  return {
    code: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs),
    license: await readFile(resolve(engineRoot, "LICENSE"), "utf8")
  };
}

export function safeBashBrowserPlugin() {
  let compiled;
  return {
    name: "safe-bash-browser-kernel",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:safe-bash-kernel") return "\0safe-bash-browser-kernel";
    },
    async load(id) {
      if (id !== "\0safe-bash-browser-kernel") return;
      compiled ??= buildBrowserEngine({ kernelOnly: true });
      const result = await compiled;
      for (const input of result.inputs) {
        const file = resolve(input);
        if (file.startsWith(`${directory}/`)) this.addWatchFile(file);
      }
      return result.code;
    },
    watchChange(id) {
      if (id.startsWith(`${directory}/`)) compiled = undefined;
    },
    async generateBundle() {
      if (compiled)
        this.emitFile({
          type: "asset",
          fileName: "safe-bash-engine.LICENSE.txt",
          source: (await compiled).license
        });
    }
  };
}
