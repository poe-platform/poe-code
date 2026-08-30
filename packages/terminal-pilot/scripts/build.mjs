import * as esbuild from "esbuild";
import path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";
import { copyTerminalPngAssets } from "./build-assets.mjs";

const { cp, mkdir, readdir, readFile, writeFile } = fs;

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootDir = path.resolve(packageDir, "../..");
const srcDir = path.join(packageDir, "src");
const distDir = path.join(packageDir, "dist");

// Read workspace package names and create source aliases (same approach as root bundle.mjs)
const packagesDir = path.join(rootDir, "packages");
const workspaceDirs = await readdir(packagesDir, { withFileTypes: true });
const workspaceAliases = {};
const workspacePackageNames = new Set();
const workspaceNpmDeps = new Set();

for (const dir of workspaceDirs.filter((d) => d.isDirectory())) {
  const pkgPath = path.join(packagesDir, dir.name, "package.json");
  let pkgContents;
  try {
    pkgContents = await readFile(pkgPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  const pkg = JSON.parse(pkgContents);
  workspacePackageNames.add(pkg.name);
  workspaceAliases[pkg.name] = path.join(packagesDir, dir.name, "src");

  // Resolve sub-path exports (e.g. "toolcraft/cli" → "packages/toolcraft/src/cli.ts")
  if (pkg.exports && typeof pkg.exports === "object") {
    for (const [subpath, value] of Object.entries(pkg.exports)) {
      if (subpath === ".") continue;
      const clean = subpath.replace(/^\.\//, "");
      // Derive source path from the export's import field (dist/x.js → src/x.ts)
      const importPath = typeof value === "string" ? value : value?.import;
      if (typeof importPath === "string") {
        const srcPath = importPath.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts");
        workspaceAliases[`${pkg.name}/${clean}`] = path.join(packagesDir, dir.name, srcPath);
      }
    }
  }

  // Collect npm dependencies from workspace packages for externalization
  for (const dep of Object.keys(pkg.dependencies || {})) {
    workspaceNpmDeps.add(dep);
  }
  for (const dep of Object.keys(pkg.peerDependencies || {})) {
    workspaceNpmDeps.add(dep);
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(packageDir, "package.json"), "utf8")
);

// External = own deps + transitive workspace npm deps, minus workspace packages themselves
const ownDeps = Object.keys(packageJson.dependencies ?? {});
const allExternalDeps = new Set([...ownDeps, ...workspaceNpmDeps]);
for (const pkg of workspacePackageNames) {
  allExternalDeps.delete(pkg);
}
const external = [...allExternalDeps, "node:*"];

async function getEntryPoints(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryRelativePath = path.join(relative, entry.name);
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await getEntryPoints(entryPath, entryRelativePath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }

    files.push(path.join(srcDir, entryRelativePath));
  }

  return files;
}

const entryPoints = await getEntryPoints(srcDir);

await esbuild.build({
  entryPoints,
  outdir: distDir,
  outbase: srcDir,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  alias: workspaceAliases,
  external,
  loader: { ".md": "text" },
  define: {
    __TERMINAL_PILOT_VERSION__: JSON.stringify(packageJson.version)
  }
});

const cliPath = path.join(distDir, "cli.js");
const cliContents = await readFile(cliPath, "utf8");

if (!cliContents.startsWith("#!/usr/bin/env node")) {
  await writeFile(cliPath, `#!/usr/bin/env node\n${cliContents}`, "utf8");
}

await assertSafeOutputDirectory(packageDir, path.join(distDir, "templates"));
await mkdir(path.join(distDir, "templates"), { recursive: true });
await cp(
  path.join(packageDir, "src", "templates", "terminal-pilot.md"),
  path.join(distDir, "templates", "terminal-pilot.md")
);

await copyTerminalPngAssets(
  fs,
  path.join(rootDir, "packages", "terminal-png", "assets"),
  path.join(packageDir, "assets")
);

// Verify every bare import in the bundle is declared in package.json deps.
// Without this, transitive workspace npm deps (e.g. yaml, jose) get externalized
// by esbuild but never installed when terminal-pilot is published.
const ownDepsSet = new Set(ownDeps);
const importRegex = /(?:^|[\s;])(?:import\s+[^"'`]*?from\s+|export\s+[^"'`]*?from\s+|import\s*)["']([^"'`]+)["']/gm;
const bundleImports = new Set();

async function collectImports(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectImports(full);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const contents = await readFile(full, "utf8");
      for (const match of contents.matchAll(importRegex)) {
        const spec = match[1];
        if (spec.startsWith(".") || spec.startsWith("node:")) continue;
        const pkgName = spec.startsWith("@")
          ? spec.split("/").slice(0, 2).join("/")
          : spec.split("/")[0];
        bundleImports.add(pkgName);
      }
    }
  }
}

await collectImports(distDir);

const missing = [...bundleImports].filter((dep) => !ownDepsSet.has(dep)).sort();
if (missing.length > 0) {
  console.error(
    `\nterminal-pilot bundle imports packages not in dependencies:\n  ${missing.join("\n  ")}\n\nAdd them to packages/terminal-pilot/package.json "dependencies" so they install when the package is published.`
  );
  process.exit(1);
}
