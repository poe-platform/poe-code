import path from "node:path";
import * as fileSystem from "node:fs/promises";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";

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
      sdk: path.join(rootDir, "packages/pandoc/src/index.ts"),
      command: path.join(rootDir, "packages/safe-bash/src/commands/pandoc/index.ts")
    },
    outdir: path.join(rootDir, "packages/pandoc/dist/public"),
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

export function resolveBrowserShellBuild(rootDir) {
  const directory = path.join(rootDir, "packages/safe-bash");
  const platform = path.join(directory, "browser/platform.mjs");
  const transport = path.join(directory, "src/commands/regex-execution/ere/transport/root.js");
  return {
    absWorkingDir: rootDir,
    entryPoints: {
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
    external: ["poe-code/safe-fs/core"],
    alias: { "node:stream/web": platform, "@poe-platform/op": path.join(rootDir, "packages/op/src/index.ts") },
    inject: [platform],
    plugins: [{
      name: "portable-shell-capabilities",
      setup(builder) {
        builder.onResolve({ filter: /platform\.js$/ }, args =>
          path.resolve(args.resolveDir, args.path) === path.join(directory, "src/commands/network/platform.js")
            ? { path: path.join(directory, "browser/network.mjs") }
            : undefined);
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
