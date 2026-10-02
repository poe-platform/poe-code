import { build } from "esbuild";
import { privateExportStarsPlugin } from "./private-export-stars.mjs";
import { privateRuntimeExportResolver } from "./private-runtime-exports.mjs";
import path from "node:path";
import { canonicalXml } from "../packages/package-lint/dist/bundle-policy.js";
import * as fileSystem from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";
import { portableLuaLibraries } from "../packages/safe-bash-command-pandoc/scripts/portable-lua.mjs";

// Portable consumers cannot select ambient Node filesystem/process capabilities.
const portableEnvironment = { process: "undefined", "process.env.FENGARICONF": "undefined" };

export function resolvePrivateCommandBuild(rootDir, profiles, workspaces, { alias, external, portable = false }) {
  const entryPoints = {};
  const subpathImports = new Set();
  for (const [name, profile] of Object.entries(profiles)) {
    if (portable ? profile.portable !== true : profile.portable === true || !name.startsWith("safe-bash-command-")) continue;
    const workspace = workspaces.find(({ pkg }) => pkg.name === name);
    // Only prepare workspaces present in this build. Referenced missing owners
    // still fail admission in the artifact traversal.
    if (!workspace) continue;
    const pkg = workspace?.pkg;
    const directory = name.startsWith("@") ? name.split("/")[1] : name;
    if (!pkg || workspace.dir !== directory || pkg.private !== true || pkg.type !== "module" || pkg.version !== profile.version ||
        !isDeepStrictEqual(pkg.dependencies ?? {}, profile.dependencies) ||
        !isDeepStrictEqual(pkg.devDependencies ?? {}, profile.devDependencies) ||
        !isDeepStrictEqual(pkg.peerDependencies ?? {}, profile.peerDependencies ?? {}) ||
        !isDeepStrictEqual(pkg.peerDependenciesMeta ?? {}, profile.peerDependenciesMeta ?? {}) ||
        Object.keys(pkg.peerDependencies ?? {}).some(peer => pkg.peerDependenciesMeta?.[peer]?.optional !== true) ||
        Object.keys(pkg.optionalDependencies ?? {}).length) {
      throw new Error("Qualified private workspace profile mismatch: " + name);
    }
    for (const key of Object.keys(pkg.imports ?? {})) subpathImports.add(key);
    for (const [route, target] of Object.entries(pkg.exports ?? {})) {
      if (Object.hasOwn(profile.optionalModules ?? {}, route)) continue;
      // This recipe prepares ESM import entries only. Other runtime profiles
      // need their own qualified build before they can be admitted here.
      for (const condition of Object.keys(target ?? {})) {
        if (condition !== "types" && condition !== "import") {
          throw new Error("Unsupported private command export condition: " + name + " " + condition);
        }
      }
      const runtime = target?.import;
      if (typeof runtime !== "string" || !runtime.startsWith("./dist/") || !runtime.endsWith(".js") ||
          runtime.split("/").some(component => component === ".." || component === "" || component.includes("\\") || component.includes("*")) ||
          target.types !== runtime.slice(0, -3) + ".d.ts") {
        throw new Error("Invalid private command build entrypoint: " + name);
      }
      // Independent workspace bundles erase dependency identities. Re-enter
      // the source graph so esbuild can share engines across command exports.
      // Transforming builds (e.g. Pandoc's portable Lua) explicitly opt out.
      const input = pkg.poeCode?.bundle?.prebuilt === true
        ? runtime : "./src/" + runtime.slice("./dist/".length, -3) + ".ts";
      entryPoints[workspace.dir + "/" + runtime.slice(2, -3)] = path.join(rootDir, "packages", workspace.dir, input);
    }
  }
  if (!Object.keys(entryPoints).length) return undefined;
  return {
    absWorkingDir: rootDir, entryPoints, alias, external: subpathImports.size ? [...new Set([...(external ?? []), ...subpathImports])] : external,
    outdir: path.join(rootDir, "packages"), allowOverwrite: true,
    bundle: true, splitting: true, chunkNames: "safe-bash/dist/command-chunks/[name]-[hash]",
    assetNames: "safe-bash/dist/command-assets/[name]-[hash]",
    loader: { ".wasm": "copy" },
    platform: portable ? "browser" : "node", format: "esm", target: portable ? "es2022" : "node22", sourcemap: true, write: false,
    ...(portable ? { define: portableEnvironment, plugins: [portableLuaLibraries], conditions: ["workerd", "worker", "browser"], inject: [path.join(rootDir, "packages/safe-bash/browser/buffer.mjs")] } : {}),
  };
}

export async function publishRootOptionalPackage(rootDir, files = fileSystem) {
  const source = path.join(rootDir, "packages/safe-bash/dist/opt-in");
  const output = path.join(rootDir, "dist/safe-bash-opt-in");
  const copy = async (directory, destination) => {
    await files.mkdir(destination, { recursive: true });
    for (const entry of await files.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const target = path.join(destination, entry.name);
      if (entry.isDirectory()) await copy(filename, target);
      else {
        let contents = await files.readFile(filename);
        if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
          contents = rewriteModuleSpecifiers(filename, contents.toString(), specifier => {
            for (const name of ["safe-bash", "safe-fs"]) {
              const prefix = "@poe-platform/" + name;
              if (specifier === prefix || specifier.startsWith(prefix + "/")) return "poe-code/" + name + specifier.slice(prefix.length);
            }
            return specifier;
          });
        }
        await files.writeFile(target, contents);
      }
    }
  };
  await copy(source, output);
}

export function resolveBrowserOpBuild(rootDir) {
  const options = resolveBrowserShellBuild(rootDir);
  return {
    ...options,
    entryPoints: { "commands/op/index.browser": options.entryPoints["commands/op/index.browser"] }
  };
}

export function resolvePortableBufferBuild(rootDir) {
  const directory = path.join(rootDir, "packages/safe-bash");
  return {
    absWorkingDir: rootDir,
    entryPoints: { "portable-buffer": path.join(directory, "src/portable-buffer.ts") },
    outdir: path.join(directory, "dist"),
    bundle: true, platform: "browser", format: "esm", target: "es2022",
    sourcemap: true, metafile: true, write: false,
  };
}

export function resolveBrowserShellBuild(rootDir, { alias = {}, external = [], imports = {} } = {}) {
  const directory = path.join(rootDir, "packages/safe-bash");
  const platform = path.join(directory, "browser/platform.mjs");
  const transport = path.join(directory, "src/commands/regex-execution/ere/transport/owner.js");
  const aliases = {
    ...alias,
    "node:stream/web": platform,
    // All importers share command/value brands, regardless of local tsconfig paths.
    "safe-bash-contracts": path.join(rootDir, "packages/safe-bash-contracts/src"),
    "safe-bash-regex-engine": path.join(rootDir, "packages/safe-bash-regex-engine/src"),
    "safe-bash-network-engine": path.join(rootDir, "packages/safe-bash-network-engine/src"),
    "safe-bash-command-op": path.join(rootDir, "packages/safe-bash-command-op/src/index.ts"),
    // Pandoc prepares its portable third-party adapters in the workspace build.
    "safe-bash-command-pandoc": path.join(rootDir, "packages/safe-bash-command-pandoc/dist"),
    "@poe-code/safe-fs": "poe-code/safe-fs",
    "@poe-code/safe-js/core": "poe-code/safe-js/core",
    "@poe-code/safe-fs/runtime-core": "poe-code/safe-fs/core",
    "@poe-code/safe-fs/fs/memory": "poe-code/safe-fs/core",
    "@poe-code/safe-fs/contracts/errors": "poe-code/safe-fs/core",
    "@poe-code/safe-fs/contracts/object": "poe-code/safe-fs/core",
    "@poe-code/safe-fs/xml": "poe-code/safe-fs/core",
    [canonicalXml.workspace]: canonicalXml.specifier,
  };
  // Aliases resolve before external admission. Leaving a source alias for a
  // canonical package embeds a second runtime identity in the browser bundle.
  for (const specifier of Object.keys(aliases)) {
    if (external.some(name => specifier === name || specifier.startsWith(name + "/"))) delete aliases[specifier];
  }
  // Declaration-only root aliases cannot satisfy emitted runtime imports.
  // Resolve those imports inside their source package so the runtime is bundled.
  const runtimeImports = Object.entries(imports)
    .filter(([, target]) => hasRuntimeTarget(target))
    .map(([specifier]) => specifier);
  const options = {
    absWorkingDir: rootDir,
    loader: { ".wasm": "copy" },
    entryPoints: {
      "commands/pandoc/index.browser": path.join(directory, "src/commands/pandoc/index.ts"),
      "commands/csvkit/index.browser": path.join(directory, "src/commands/csvkit/index.ts"),
      "commands/ssconvert/index.browser": path.join(directory, "src/commands/ssconvert/index.ts"),
      "search.browser": path.join(directory, "src/search.ts"),
      "commands/metadata/index.browser": path.join(directory, "src/commands/metadata/index.ts"),
      "commands/archive/index.browser": path.join(directory, "src/commands/archive/index.ts"),
      "commands/table-text/index.browser": path.join(directory, "src/commands/table-text/index.ts"),
      "commands/stream-inspection/index.browser": path.join(directory, "src/commands/stream-inspection/index.ts"),
      "commands/stream-format/index.browser": path.join(directory, "src/commands/stream-format/index.ts"),
      "commands/split/index.browser": path.join(directory, "src/commands/split/index.ts"),
      "commands/time-env/index.browser": path.join(directory, "src/commands/time-env/index.ts"),
      "commands/tree/index.browser": path.join(directory, "src/commands/tree/index.ts"),
      "commands/file/index.browser": path.join(directory, "src/commands/file/index.ts"),
      "commands/grep-aliases/index.browser": path.join(directory, "src/commands/grep-aliases/index.ts"),
      "commands/column/index.browser": path.join(directory, "src/commands/column/index.ts"),
      "commands/caller/index.browser": path.join(directory, "src/commands/caller/index.ts"),
      "commands/html-to-markdown/index.browser": path.join(directory, "src/commands/html-to-markdown/index.ts"),
      "commands/du/index.browser": path.join(directory, "src/commands/du/index.ts"),
      "commands/expr/index.browser": path.join(directory, "src/commands/expr/index.ts"),
      "commands/apply-patch/index.browser": path.join(directory, "src/commands/apply-patch/index.ts"),
      "commands/chmod/index.browser": path.join(directory, "src/commands/chmod/index.ts"),
      "commands/stat/index.browser": path.join(directory, "src/commands/stat/index.ts"),
      "commands/mktemp/index.browser": path.join(directory, "src/commands/mktemp/index.ts"),
      "commands/media/index.browser": path.join(directory, "src/commands/media/index.ts"),
      "commands/docx/index.browser": path.join(directory, "src/commands/docx/index.ts"),
      "commands/bc/index.browser": path.join(directory, "src/commands/bc/index.ts"),
      "commands/pptx/index.browser": path.join(directory, "src/commands/pptx/index.ts"),
      "commands/python/index.browser": path.join(directory, "src/commands/python/index.ts"),
      "commands/python/executor.browser": path.join(directory, "src/commands/python/executor.ts"),
      "commands/python/worker.browser": path.join(directory, "src/commands/python/worker.ts"),
      "commands/op/index.browser": path.join(directory, "src/commands/op/index.ts"),
      "commands/llm/index.browser": path.join(directory, "src/commands/llm/index.ts"),
      "commands/llm/providers/index.browser": path.join(directory, "src/commands/llm/providers/index.ts"),
      "core.browser": path.join(directory, "src/core.browser.ts"),
      "trap.browser": path.join(directory, "src/trap.browser.ts"),
      "portable-buffer": path.join(directory, "src/portable-buffer.ts"),
      "shell-entry.browser": path.join(directory, "src/shell-entry.ts"),
      "registry-entry.browser": path.join(directory, "src/registry-entry.ts"),
      "plugins/index.browser": path.join(directory, "src/plugins/index.ts"),
      "commands/regex-execution/public.browser": path.join(directory, "src/commands/regex-execution/public.ts"),
      "yq-browser/index": path.join(directory, "src/yq.browser.ts"),
      "jobs.browser": path.join(directory, "src/jobs.ts"),
      "optional-host.browser": path.join(directory, "src/optional-host.ts"),
      "commands/xml/index.browser": path.join(directory, "src/commands/xml/index.ts"),
      "commands/yq/index.browser": path.join(directory, "src/commands/yq/index.ts"),
      "commands/network/index.browser": path.join(directory, "src/commands/network/public.ts"),
      "commands/node/index.browser": path.join(directory, "src/commands/node/browser.ts"),
      "commands/csplit/index.browser": path.join(directory, "src/commands/csplit/index.ts"),
      "commands/pr/index.browser": path.join(directory, "src/commands/pr/index.ts"),
      "commands/tsort/index.browser": path.join(directory, "src/commands/tsort/index.ts"),
      "commands/factor/index.browser": path.join(directory, "src/commands/factor/index.ts"),
      "commands/getopt/index.browser": path.join(directory, "src/commands/getopt/index.ts"),
      "commands/hexdump/index.browser": path.join(directory, "src/commands/hexdump/index.ts"),
      "commands/iconv/index.browser": path.join(directory, "src/commands/iconv/index.ts"),
      "commands/line-endings/index.browser": path.join(directory, "src/commands/line-endings/index.ts"),
      "commands/mdq/index.browser": path.join(directory, "src/commands/mdq/index.ts"),
    },
    outdir: path.join(directory, "dist"),
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    platform: "browser",
    define: portableEnvironment,
    conditions: ["workerd", "worker", "browser"],
    format: "esm",
    target: "es2022",
    sourcemap: true,
    metafile: true,
    write: false,
    external: [...new Set(["poe-code/safe-fs/core", ...external, ...runtimeImports])],
    alias: aliases,
    inject: [platform],
    plugins: [portableLuaLibraries, {
      name: "portable-shell-capabilities",
      setup(builder) {
        builder.onResolve({ filter: /^safe-bash-contracts(?:\/|$)/ }, args => {
          const external = builder.initialOptions.external ?? [];
          if (external.includes("safe-bash-contracts") || external.includes(args.path)) return { path: args.path, external: true };
          const subpath = args.path === "safe-bash-contracts" ? "index" : args.path.slice("safe-bash-contracts/".length);
          return { path: path.join(rootDir, "packages/safe-bash-contracts/src", subpath + ".ts") };
        });
        builder.onResolve({ filter: /^#safe-bash-network-platform$/ }, () =>
          ({ path: path.join(directory, "src/commands/network/platform-portable.ts") }));
        builder.onResolve({ filter: /(?:^|\/)owner\.js$/ }, args =>
          path.resolve(args.resolveDir, args.path) === transport
            ? { path: path.join(directory, "browser/regex.mjs") }
            : undefined);
        builder.onResolve({ filter: /^node:/ }, args => {
          if (args.path === "node:util" && args.importer === path.join(directory, "src/commands/regex-execution/ere/transport/validation.ts")) return { path: path.join(directory, "browser/regex-validation.mjs") };
          if (args.path === "node:stream/web" || args.path === "node:path" && args.importer === path.join(directory, "src/contracts/path.ts")) return { path: platform };
          return { errors: [{ text: `Node-only module in portable shell: ${args.path}` }] };
        });
      },
    }],
  };
  if (external.length) {
    const recipe = { ...options, plugins: [...options.plugins] };
    options.plugins.unshift(privateExportStarsPlugin(new Map(), fileSystem, path.join(directory, "src"),
      privateRuntimeExportResolver(rootDir, external, fileSystem, recipe, build)));
  }
  return options;
}

function hasRuntimeTarget(target) {
  if (typeof target === "string") return true;
  if (Array.isArray(target)) return target.some(hasRuntimeTarget);
  if (target === null || typeof target !== "object") return false;
  return Object.entries(target).some(([condition, value]) =>
    condition !== "types" && hasRuntimeTarget(value));
}

export async function buildBrowserShellOutputs(rootDir, { alias = {}, external = [], files } = {}) {
  const esbuild = await import("esbuild");
  const { publishBundleOutputs } = await import("./publish-bundle.mjs");
  let shell;
  for (const options of [resolveBrowserShellBuild(rootDir, { alias, external }), resolvePortableBufferBuild(rootDir)]) {
    const result = await esbuild.build(options);
    await publishBundleOutputs(
      result,
      { outdir: options.outdir, entryPoints: Object.values(options.entryPoints), workingDirectory: rootDir },
      files
    );
    if (Object.hasOwn(options.entryPoints, "core.browser")) shell = result;
  }
  return shell;
}
