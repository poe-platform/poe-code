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
  const browserPlugin = (worker = false) => ({
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
      for (const [owner, identity] of [
        ["commands/regex-execution/client.js", "regex"],
        ["commands/regex-execution/ere/transport/owner.js", "ere"]
      ]) {
        builder.onLoad({ filter: /\.js$/ }, async (args) => {
          if (args.path !== resolve(bash, owner)) return;
          return {
            contents: selectBrowserWorker(await readFile(args.path, "utf8"), identity),
            resolveDir: dirname(args.path)
          };
        });
      }
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
        contents: [
          `export { Shell } from ${JSON.stringify(resolve(bash, "shell/index.js"))};`,
          `export { createMemoryFileSystem, resolvePath, normalizePath, readBytes, FsError } from ${JSON.stringify(filesystem)};`,
          `export { createAgentCommands } from ${JSON.stringify(resolve(bash, "plugins/index.js"))};`
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
      builder.onResolve({ filter: /^node:/ }, (args) => {
        if (["node:stream/web", "node:perf_hooks"].includes(args.path))
          return { path: resolve(directory, "platform.ts") };
        if (args.path === "node:worker_threads")
          return { path: resolve(directory, worker ? "worker-context.mjs" : "workers.mjs") };
        if (["node:buffer", "node:util"].includes(args.path))
          return { path: resolve(directory, "browser-builtins.mjs") };
        if (args.path === "node:crypto") return { path: resolve(directory, "browser-crypto.mjs") };
        if (args.path === "node:stream/promises")
          return { path: resolve(directory, "browser-streams.mjs") };
        if (args.path === "node:zlib") return { path: resolve(directory, "browser-zlib.mjs") };
        if (args.path === "node:timers") return { path: resolve(directory, "browser-timers.mjs") };
        if (args.path === "node:timers/promises")
          return { path: resolve(directory, "browser-timer-promises.mjs") };
        const module = args.path.slice(5);
        if (["path", "stream"].includes(module))
          return { path: resolve(polyfillsRoot, "nodelibs/browser", `${module}.js`) };
        throw new Error(
          `Unsupported Node capability in browser engine: ${args.path} from ${args.importer}`
        );
      });
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
  const result = await build({
    ...shared,
    ...(options.kernelOnly
      ? { stdin: { contents: 'export * from "virtual:safe-bash-kernel";', resolveDir: directory } }
      : { entryPoints: [resolve(directory, "index.ts")] }),
    format: "esm",
    plugins: [browserPlugin()]
  });
  for (const input of Object.keys(result.metafile.inputs)) inputs.add(input);
  return {
    code: result.outputFiles[0].text,
    inputs: [...inputs],
    license: await readFile(resolve(engineRoot, "LICENSE"), "utf8"),
    platformLicense: await readFile(resolve(polyfillsRoot, "LICENSE"), "utf8")
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
      }
    }
  };
}
