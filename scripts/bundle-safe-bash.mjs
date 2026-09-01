import path from "node:path";

export function resolveBrowserShellBuild(rootDir) {
  const directory = path.join(rootDir, "packages/safe-bash");
  const platform = path.join(directory, "browser/platform.mjs");
  const transport = path.join(directory, "src/commands/regex-execution/ere/transport/root.js");
  return {
    absWorkingDir: rootDir,
    entryPoints: [path.join(directory, "src/browser.ts")],
    outfile: path.join(directory, "dist/browser.js"),
    bundle: true,
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    format: "esm",
    target: "es2022",
    sourcemap: true,
    metafile: true,
    write: false,
    external: ["poe-code/safe-fs/core"],
    alias: { "poe-code/safe-fs": "poe-code/safe-fs/core", "node:stream/web": platform },
    inject: [platform],
    plugins: [{
      name: "portable-shell-capabilities",
      setup(builder) {
        builder.onResolve({ filter: /regex-execution\/ere\/transport\/root\.js$/ }, args =>
          path.resolve(args.resolveDir, args.path) === transport
            ? { path: path.join(directory, "browser/regex.mjs") }
            : undefined);
        builder.onResolve({ filter: /^node:/ }, args => args.path === "node:stream/web"
          ? { path: platform }
          : { errors: [{ text: `Node-only module in browser shell: ${args.path}` }] });
      },
    }],
  };
}
