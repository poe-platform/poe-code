import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentRootState } from "./root-state-adapter.mjs";
import { limitCommandBuffers } from "./buffer-limit-adapter.mjs";
import { selectBrowserWorker } from "./worker-source-adapter.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function kernelExports(bash, filesystem) {
  return [
    `export { Shell } from ${JSON.stringify(resolve(bash, "shell/index.js"))};`,
    `export { createMemoryFileSystem, resolvePath, normalizePath, readBytes, FsError } from ${JSON.stringify(filesystem)};`,
    `export { createAgentCommands } from ${JSON.stringify(resolve(bash, "plugins/index.js"))};`
  ].join("\n");
}

function resolveBrowserBuiltin(id, worker, polyfillsRoot, importer) {
  if (["node:stream/web", "node:perf_hooks"].includes(id)) return resolve(directory, "platform.ts");
  if (id === "node:worker_threads") return resolve(directory, worker ? "worker-context.mjs" : "workers.mjs");
  if (["node:buffer", "node:util"].includes(id)) return resolve(directory, "browser-builtins.mjs");
  if (id === "node:crypto") return resolve(directory, "browser-crypto.mjs");
  if (id === "node:stream/promises") return resolve(directory, "browser-streams.mjs");
  if (id === "node:zlib") return resolve(directory, "browser-zlib.mjs");
  if (id === "node:timers") return resolve(directory, "browser-timers.mjs");
  if (id === "node:timers/promises") return resolve(directory, "browser-timer-promises.mjs");
  const name = id.slice(5);
  if (["path", "stream"].includes(name)) return resolve(polyfillsRoot, "nodelibs/browser", `${name}.js`);
  throw new Error(`Unsupported Node capability in browser engine: ${id} from ${importer}`);
}

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
  const polyfillsRoot = resolve(require.resolve("@jspm/core/nodelibs/buffer"), "../../..");
  const sources = {};
  const inputs = new Set();
  const adapters = new Map([
    [resolve(bash, "commands/internal.js"), { transform: limitCommandBuffers }],
    [resolve(bash, "shell/shell.js"), { transform: instrumentRootState }],
    [resolve(bash, "commands/regex-execution/client.js"), { transform: selectBrowserWorker, identity: "regex" }],
    [resolve(bash, "commands/regex-execution/ere/transport/owner.js"), { transform: selectBrowserWorker, identity: "ere" }]
  ]);
  const browserPlugin = (worker = false) => ({
    name: "safe-bash-explicit-browser-platform",
    setup(builder) {
      builder.onLoad({ filter: /\.js$/ }, async (args) => {
        const adapter = adapters.get(args.path);
        if (!adapter) return;
        return {
          contents: adapter.transform(await readFile(args.path, "utf8"), adapter.identity),
          resolveDir: dirname(args.path)
        };
      });
      builder.onResolve({ filter: /^virtual:safe-bash-worker-sources$/ }, () => ({
        path: "workers",
        namespace: "safe-bash-browser"
      }));
      builder.onLoad({ filter: /^workers$/, namespace: "safe-bash-browser" }, () => ({
        contents: `export const sources = ${JSON.stringify(sources)};`,
        resolveDir: directory
      }));
      builder.onResolve({ filter: /^virtual:safe-bash-kernel$/ }, () => ({
        path: "kernel",
        namespace: "safe-bash-browser"
      }));
      builder.onLoad({ filter: /^kernel$/, namespace: "safe-bash-browser" }, () => ({
        contents: kernelExports(bash, filesystem),
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
      builder.onResolve({ filter: /^node:/ }, (args) => ({
        path: resolveBrowserBuiltin(args.path, worker, polyfillsRoot, args.importer)
      }));
    }
  });
  const shared = {
    bundle: true,
    write: false,
    platform: "browser",
    target: "es2022",
    minify: options.minify ?? false,
    metafile: true,
    inject: [resolve(directory, "platform.ts")]
  };
  for (const [identity, entry] of [
    ["regex", "commands/regex-execution/worker.js"],
    ["ere", "commands/regex-execution/ere/transport/worker-entry.js"]
  ]) {
    const compiled = await build({
      ...shared,
      entryPoints: [resolve(bash, entry)],
      format: "iife",
      minify: true,
      plugins: [browserPlugin(true)]
    });
    sources[identity] = compiled.outputFiles[0].text;
    for (const input of Object.keys(compiled.metafile.inputs)) inputs.add(input);
  }
  const result = options.workersOnly ? undefined : await build({
    ...shared,
    ...(options.entry
      ? { entryPoints: [resolve(directory, options.entry)] }
      : options.kernelOnly
      ? { stdin: { contents: 'export * from "virtual:safe-bash-kernel";', resolveDir: directory } }
      : { entryPoints: [resolve(directory, "index.ts")] }),
    format: "esm",
    plugins: [browserPlugin()]
  });
  if (result) for (const input of Object.keys(result.metafile.inputs)) inputs.add(input);
  return {
    code: result?.outputFiles[0].text ?? "",
    bash,
    filesystem,
    polyfillsRoot,
    adapters,
    workerSources: sources,
    inputs: [...inputs],
    license: await readFile(resolve(engineRoot, "LICENSE"), "utf8"),
    platformLicense: await readFile(resolve(polyfillsRoot, "LICENSE"), "utf8"),
    hashesLicense: await readFile(resolve(dirname(require.resolve("@noble/hashes/sha2.js")), "LICENSE"), "utf8")
  };
}

export function safeBashBrowserPlugin() {
  let compiled;
  const prepare = () => compiled ??= buildBrowserEngine({ workersOnly: true });
  const globals = {
    name: "safe-bash-module-globals",
    setup(builder) {
      builder.onResolve({ filter: /^virtual:safe-bash-globals$/ }, () => ({ path: "globals", namespace: "safe-bash-globals" }));
      builder.onLoad({ filter: /^globals$/, namespace: "safe-bash-globals" }, () => ({
        contents: `export { Buffer, setImmediate, clearImmediate, setTimeout, clearTimeout, TransformStream, performance } from ${JSON.stringify(resolve(directory, "platform.ts"))};`
      }));
    }
  };
  return {
    name: "safe-bash-browser-kernel",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === "virtual:safe-bash-kernel") return "\0safe-bash-browser-kernel";
      if (id === "virtual:safe-bash-worker-sources") return "\0safe-bash-browser-workers";
      if (id === "poe-code/safe-fs") return "\0safe-bash-browser-filesystem";
      if (id.startsWith("node:")) return prepare().then(result => resolveBrowserBuiltin(id, false, result.polyfillsRoot, importer));
    },
    async load(id) {
      if (!["\0safe-bash-browser-kernel", "\0safe-bash-browser-workers", "\0safe-bash-browser-filesystem"].includes(id)) return;
      const result = await prepare();
      for (const input of result.inputs) {
        const file = resolve(input);
        if (file.startsWith(`${directory}/`)) this.addWatchFile(file);
      }
      for (const name of ["platform.ts", "path.ts", "worker-context.mjs", "workers.mjs"]) this.addWatchFile(resolve(directory, name));
      if (id === "\0safe-bash-browser-kernel") return kernelExports(result.bash, result.filesystem);
      if (id === "\0safe-bash-browser-workers") return `export const sources = ${JSON.stringify(result.workerSources)};`;
      return `export * from ${JSON.stringify(result.filesystem)}; export * from ${JSON.stringify(resolve(directory, "path.ts"))};`;
    },
    async transform(code, id) {
      const filename = id.split("?")[0];
      if (!filename.endsWith(".js") || !filename.includes("/safe-bash-engine/packages/")) return;
      const prepared = await prepare();
      if (!filename.startsWith(`${prepared.bash}/`) && !filename.startsWith(`${dirname(prepared.filesystem)}/`)) return;
      const adapter = prepared.adapters.get(filename);
      const transformed = await build({
        stdin: { contents: adapter ? adapter.transform(code, adapter.identity) : code, resolveDir: dirname(filename), sourcefile: filename, loader: "js" },
        bundle: false,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2022",
        inject: ["virtual:safe-bash-globals"],
        plugins: [globals]
      });
      return { code: transformed.outputFiles[0].text, map: null };
    },
    watchChange(id) {
      if (id.startsWith(`${directory}/`)) compiled = undefined;
    },
    async generateBundle() {
      if (compiled) {
        const result = await compiled;
        this.emitFile({
          type: "asset",
          fileName: "safe-bash-engine.LICENSE.txt",
          source: result.license
        });
        this.emitFile({
          type: "asset",
          fileName: "browser-platform.LICENSE.txt",
          source: result.platformLicense
        });
        this.emitFile({
          type: "asset",
          fileName: "browser-hashes.LICENSE.txt",
          source: result.hashesLicense
        });
      }
    }
  };
}
