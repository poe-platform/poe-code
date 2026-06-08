import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * Compute the esbuild graph shared by every bundle in scripts/bundle.mjs:
 *
 * - `alias`: maps each workspace package (and its sub-path exports) to its
 *   TypeScript source, so the bundle compiles workspace code just-in-time.
 * - `external`: the packages left for npm to install — root runtime deps,
 *   root optional runtime deps, plus the third-party deps of workspace packages,
 *   never the workspace packages themselves (those get inlined via `alias`).
 *
 * Extracted so the alias/external computation lives in one place.
 *
 * @param {string} rootDir Absolute path to the workspace root.
 * @param {{ dir: string, pkg: any }[]} packageJsons Parsed `packages/*` manifests.
 */
export async function resolveBundleGraph(rootDir, packageJsons) {
  const packagesDir = path.join(rootDir, "packages");
  const alias = {};
  const workspacePackageNames = new Set();
  const workspaceDeps = new Set();

  for (const { dir, pkg } of packageJsons) {
    workspacePackageNames.add(pkg.name);
    // Resolve workspace packages to source (just-in-time compilation).
    alias[pkg.name] = path.join(packagesDir, dir, "src/index.ts");
    // Resolve sub-path exports (e.g. "toolcraft/cli" → packages/toolcraft/src/cli.ts).
    if (pkg.exports && typeof pkg.exports === "object") {
      for (const subpath of Object.keys(pkg.exports)) {
        if (subpath === ".") continue;
        const clean = subpath.startsWith("./") ? subpath.slice(2) : subpath;
        alias[`${pkg.name}/${clean}`] = path.join(packagesDir, dir, "src", `${clean}.ts`);
      }
    }
    for (const dep of Object.keys(pkg.dependencies || {})) workspaceDeps.add(dep);
  }

  const rootPackageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const runtimeDeps = [
    ...Object.keys(rootPackageJson.dependencies || {}),
    ...Object.keys(rootPackageJson.optionalDependencies || {})
  ].filter(
    (dep) => !workspacePackageNames.has(dep)
  );
  const externalSet = new Set([...runtimeDeps, ...workspaceDeps]);
  for (const name of workspacePackageNames) externalSet.delete(name);

  return {
    entryPoints: [path.join(rootDir, "src/index.ts")],
    alias,
    external: [...externalSet, "node:*"],
    workspacePackageNames
  };
}
