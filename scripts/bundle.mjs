import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { versionGateSnippet } from "./node-version-gate.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");

// Read workspace package names and create source aliases
const packagesDir = path.join(rootDir, "packages");
const workspaceDirs = await readdir(packagesDir, { withFileTypes: true });
const workspaceAliases = {};
const workspacePackageNames = new Set();

const workspaceDeps = new Set();

for (const dir of workspaceDirs.filter((d) => d.isDirectory())) {
  const pkgPath = path.join(packagesDir, dir.name, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  workspacePackageNames.add(pkg.name);
  // Resolve workspace packages to source (Just-in-Time compilation)
  workspaceAliases[pkg.name] = path.join(packagesDir, dir.name, "src/index.ts");
  // Collect workspace package dependencies for externalization
  for (const dep of Object.keys(pkg.dependencies || {})) {
    workspaceDeps.add(dep);
  }
}

// External deps = root package.json dependencies (what users install via npm)
const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8")
);
const runtimeDeps = Object.keys(packageJson.dependencies || {}).filter(
  (dep) => !workspacePackageNames.has(dep)
);
// Externalize root deps + workspace package deps (excluding workspace packages themselves)
const allExternalDeps = new Set([...runtimeDeps, ...workspaceDeps]);
for (const pkg of workspacePackageNames) {
  allExternalDeps.delete(pkg);
}
const externalDeps = [...allExternalDeps, "node:*"];

// Plugin to strip shebangs from source files
const stripShebangPlugin = {
  name: "strip-shebang",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      let contents = await readFile(args.path, "utf8");
      if (contents.startsWith("#!")) {
        contents = contents.replace(/^#!.*\n/, "");
      }
      return { contents, loader: "ts" };
    });
  },
};

function isProviderSourceFile(filename) {
  if (!filename.endsWith(".ts")) {
    return false;
  }
  if (filename.endsWith(".d.ts")) {
    return false;
  }
  if (filename.endsWith(".test.ts")) {
    return false;
  }
  if (
    filename === "index.ts" ||
    filename === "create-provider.ts" ||
    filename === "spawn-options.ts"
  ) {
    return false;
  }
  return true;
}

async function getProviderEntryPoints(root) {
  const providersDir = path.join(root, "src", "providers");
  const entries = await readdir(providersDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isProviderSourceFile(entry.name)) continue;
    files.push(path.join(providersDir, entry.name));
  }
  return files;
}

await esbuild.build({
  entryPoints: [path.join(rootDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(rootDir, "dist/index.js"),
  external: externalDeps,
  alias: workspaceAliases,
  banner: undefined,
  sourcemap: true,
  plugins: [stripShebangPlugin],
  loader: { ".md": "text", ".hbs": "text", ".log": "text" },
});

const providerEntryPoints = await getProviderEntryPoints(rootDir);
if (providerEntryPoints.length > 0) {
  await esbuild.build({
    entryPoints: providerEntryPoints,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outdir: path.join(rootDir, "dist", "providers"),
    entryNames: "[name]",
    external: externalDeps,
    alias: workspaceAliases,
    banner: undefined,
    sourcemap: true,
    plugins: [stripShebangPlugin],
    loader: { ".md": "text", ".hbs": "text", ".log": "text" },
  });
}

// Generate a CJS entry point with a Node.js version gate.
// Written in ES5 syntax so even ancient Node versions parse it and
// print a friendly error instead of crashing on modern syntax.
const wrapperPath = path.join(rootDir, "dist/bin.cjs");
const wrapper = [
  "#!/usr/bin/env node",
  versionGateSnippet("poe-code"),
  'import("./index.js").then(function (m) { m.main(); }).catch(function (err) { console.error(err); process.exit(1); });',
  "",
].join("\n");
await writeFile(wrapperPath, wrapper, { encoding: "utf8" });

console.log("Bundle complete: dist/index.js + dist/bin.cjs");
