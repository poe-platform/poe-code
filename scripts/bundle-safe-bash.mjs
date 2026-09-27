import path from "node:path";
import * as fileSystem from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";

export function resolvePrivateCommandBuild(rootDir, profiles, workspaces, { alias, external, portable = false }) {
  const entryPoints = {};
  for (const [name, profile] of Object.entries(profiles)) {
    if (portable ? profile.portable !== true : profile.portable === true || !name.startsWith("safe-bash-command-")) continue;
    const workspace = workspaces.find(({ pkg }) => pkg.name === name);
    // Only prepare workspaces present in this build. Referenced missing owners
    // still fail admission in the artifact traversal.
    if (!workspace) continue;
    const pkg = workspace?.pkg;
    if (!pkg || workspace.dir !== name || pkg.private !== true || pkg.type !== "module" || pkg.version !== profile.version ||
        !isDeepStrictEqual(pkg.dependencies ?? {}, profile.dependencies) ||
        !isDeepStrictEqual(pkg.devDependencies ?? {}, profile.devDependencies) ||
        !isDeepStrictEqual(pkg.peerDependencies ?? {}, profile.peerDependencies ?? {}) ||
        !isDeepStrictEqual(pkg.peerDependenciesMeta ?? {}, profile.peerDependenciesMeta ?? {}) ||
        Object.keys(pkg.peerDependencies ?? {}).some(peer => pkg.peerDependenciesMeta?.[peer]?.optional !== true) ||
        Object.keys(pkg.optionalDependencies ?? {}).length) {
      throw new Error("Qualified private workspace profile mismatch: " + name);
    }
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
      entryPoints[name + "/" + runtime.slice(2, -3)] = path.join(rootDir, "packages", name, runtime);
    }
  }
  if (!Object.keys(entryPoints).length) return undefined;
  return {
    absWorkingDir: rootDir, entryPoints, alias, external,
    outdir: path.join(rootDir, "packages"), allowOverwrite: true,
    bundle: true, splitting: true, chunkNames: "safe-bash/dist/command-chunks/[name]-[hash]",
    loader: { ".wasm": "copy" },
    platform: portable ? "browser" : "node", format: "esm", target: portable ? "es2022" : "node22", sourcemap: true, write: false,
    ...(portable ? { conditions: ["workerd", "worker", "browser"], inject: [path.join(rootDir, "packages/safe-bash/browser/buffer.mjs")] } : {}),
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

export function resolvePandocBuild(rootDir) {
  const portable = resolveBrowserShellBuild(rootDir);
  return {
    ...portable,
    entryPoints: {
      sdk: path.join(rootDir, "packages/safe-bash-command-pandoc/src/index.ts"),
      command: path.join(rootDir, "packages/safe-bash/src/commands/pandoc/index.ts")
    },
    outdir: path.join(rootDir, "packages/safe-bash-command-pandoc/dist/public"),
    external: ["poe-code/safe-fs/core"]
  };
}

export function resolveBrowserOpBuild(rootDir) {
  const options = resolveBrowserShellBuild(rootDir);
  return {
    ...options,
    entryPoints: { "commands/op/index.browser": options.entryPoints["commands/op/index.browser"] }
  };
}

export function resolveBrowserYqBuild(rootDir, { alias = {}, external = [] } = {}) {
  const directory = path.join(rootDir, "packages/safe-bash");
  return {
    absWorkingDir: rootDir,
    entryPoints: { index: path.join(directory, "src/yq.browser.ts") },
    outdir: path.join(directory, "dist/yq-browser"),
    bundle: true, splitting: true, chunkNames: "chunks/[name]-[hash]",
    platform: "browser", conditions: ["workerd", "worker", "browser"],
    format: "esm", target: "es2022", sourcemap: true, metafile: true, write: false,
    alias: { "@poe-code/safe-fs": "poe-code/safe-fs", ...alias },
    external: [...new Set(["poe-code/safe-fs/core", "safe-bash-contracts", ...external.filter(name => !name.startsWith("safe-bash-") || name === "safe-bash-contracts")])],
    inject: [path.join(directory, "browser/buffer.mjs")],
  };
}

export function resolveBrowserShellBuild(rootDir, { alias = {}, external = [] } = {}) {
  const directory = path.join(rootDir, "packages/safe-bash");
  const platform = path.join(directory, "browser/platform.mjs");
  const transport = path.join(directory, "src/commands/regex-execution/ere/transport/root.js");
  const aliases = {
    ...alias,
    "node:stream/web": platform,
    "safe-bash-contracts": path.join(rootDir, "packages/safe-bash-contracts/src"),
    "safe-bash-command-op": path.join(rootDir, "packages/safe-bash-command-op/src/index.ts"),
    "@poe-code/safe-fs": "poe-code/safe-fs",
    "@poe-code/safe-fs/contracts/errors": "poe-code/safe-fs/core",
    "@poe-code/safe-fs/contracts/object": "poe-code/safe-fs/core",
  };
  // Aliases resolve before external admission. Leaving a source alias for a
  // canonical package embeds a second runtime identity in the browser bundle.
  for (const specifier of Object.keys(aliases)) {
    if (external.some(name => specifier === name || specifier.startsWith(name + "/"))) delete aliases[specifier];
  }
  return {
    absWorkingDir: rootDir,
    entryPoints: {
      "commands/media/index.browser": path.join(directory, "src/commands/media/index.ts"),
      "commands/docx/index.browser": path.join(directory, "src/commands/docx/index.ts"),
      "commands/python/index.browser": path.join(directory, "src/commands/python/index.ts"),
      "commands/python/worker.browser": path.join(directory, "src/commands/python/worker.ts"),
      "commands/op/index.browser": path.join(directory, "src/commands/op/index.ts"),
      "commands/llm/index.browser": path.join(directory, "src/commands/llm/index.ts"),
      "commands/llm/providers/index.browser": path.join(directory, "src/commands/llm/providers/index.ts"),
      "core.browser": path.join(directory, "src/core.browser.ts"),
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
    },
    outdir: path.join(directory, "dist"),
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    format: "esm",
    target: "es2022",
    sourcemap: true,
    metafile: true,
    write: false,
    external: [...new Set(["poe-code/safe-fs/core", ...external])],
    alias: aliases,
    inject: [platform],
    plugins: [{
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
        builder.onResolve({ filter: /regex-execution\/ere\/transport\/root\.js$/ }, args =>
          path.resolve(args.resolveDir, args.path) === transport
            ? { path: path.join(directory, "browser/regex.mjs") }
            : undefined);
        builder.onResolve({ filter: /^node:/ }, args => {
          if (args.path === "node:stream/web" || args.path === "node:path" && args.importer === path.join(directory, "src/contracts/path.ts")) return { path: platform };
          return { errors: [{ text: `Node-only module in portable shell: ${args.path}` }] };
        });
      },
    }],
  };
}

export async function buildBrowserShellOutputs(rootDir, { alias = {}, external = [], files } = {}) {
  const esbuild = await import("esbuild");
  const { publishBundleOutputs } = await import("./publish-bundle.mjs");
  let shell;
  for (const options of [resolveBrowserShellBuild(rootDir, { alias, external }), resolveBrowserYqBuild(rootDir, { alias, external })]) {
    const result = await esbuild.build(options);
    await publishBundleOutputs(
      result,
      { outdir: options.outdir, entryPoints: Object.values(options.entryPoints), workingDirectory: rootDir },
      files
    );
    shell ??= result;
  }
  return shell;
}
