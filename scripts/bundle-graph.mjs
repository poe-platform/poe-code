import path from "node:path";
import { readFile } from "node:fs/promises";

export function resolveConsumerGraph(graph, canonical) {
  return {
    alias: Object.fromEntries(
      Object.entries(graph.alias).map(([specifier, source]) => [
        specifier,
        specifier === canonical.workspace || specifier.startsWith(`${canonical.workspace}/`)
          ? canonical.specifier
          : source
      ])
    ),
    external: [...new Set([...graph.external, canonical.specifier])]
  };
}

export function findUnreachableBundleOutputs(metafile, entryPoints, workingDirectory) {
  const unmatchedEntries = new Set(
    entryPoints.map((entry) => path.resolve(workingDirectory, entry))
  );
  if (unmatchedEntries.size === 0) {
    throw new Error("At least one declared entry point is required for bundle cleanup.");
  }

  const outputs = new Map();
  for (const [filename, output] of Object.entries(metafile.outputs)) {
    const resolvedFilename = path.resolve(workingDirectory, filename);
    if (outputs.has(resolvedFilename)) {
      throw new Error(`Duplicate bundle output: ${resolvedFilename}`);
    }
    outputs.set(resolvedFilename, output);
  }
  const declaredEntries = new Set(unmatchedEntries);
  const pending = [];
  for (const [filename, output] of outputs) {
    if (output.entryPoint === undefined) continue;
    const entry = path.resolve(workingDirectory, output.entryPoint);
    if (declaredEntries.has(entry)) {
      unmatchedEntries.delete(entry);
      pending.push(filename);
    }
  }
  if (unmatchedEntries.size > 0) {
    throw new Error(`Missing bundle entry point: ${[...unmatchedEntries].join(", ")}`);
  }

  const reachable = new Set();
  while (pending.length > 0) {
    const filename = pending.pop();
    if (reachable.has(filename)) continue;
    const output = outputs.get(filename);
    if (output === undefined) {
      throw new Error(`Missing bundle output: ${filename}`);
    }
    reachable.add(filename);
    for (const dependency of output.imports) {
      if (!dependency.external) pending.push(path.resolve(workingDirectory, dependency.path));
    }
    if (output.cssBundle !== undefined) {
      pending.push(path.resolve(workingDirectory, output.cssBundle));
    }
    if (outputs.has(`${filename}.map`)) pending.push(`${filename}.map`);
  }

  return Object.keys(metafile.outputs).filter(
    (filename) => !reachable.has(path.resolve(workingDirectory, filename))
  );
}

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
export async function resolveBundleGraph(rootDir, packageJsons, fileSystem = { readFile }) {
  const packagesDir = path.join(rootDir, "packages");
  const alias = {};
  const workspacePackageNames = new Set();
  const workspaceDeps = new Set();

  for (const { dir, pkg } of packageJsons) {
    workspacePackageNames.add(pkg.name);
    // Resolve workspace packages to source (just-in-time compilation).
    alias[pkg.name] = path.join(packagesDir, dir, "src/index.ts");
    // Resolve sub-path exports to the source behind their built import target
    // (e.g. "./configs" → "./dist/configs/index.js" → src/configs/index.ts).
    if (pkg.exports && typeof pkg.exports === "object") {
      for (const [subpath, target] of Object.entries(pkg.exports)) {
        if (subpath === ".") continue;
        const clean = subpath.startsWith("./") ? subpath.slice(2) : subpath;
        const built = typeof target === "string" ? target : (target.import ?? target.default);
        if (typeof built !== "string" || !built.startsWith("./dist/") || !built.endsWith(".js")) {
          throw new Error(
            `${pkg.name} export "${subpath}" must target ./dist/*.js to be bundled from source, got ${JSON.stringify(target)}`
          );
        }
        const source = `${built.slice("./dist/".length, -".js".length)}.ts`;
        alias[`${pkg.name}/${clean}`] = path.join(packagesDir, dir, "src", source);
      }
    }
    for (const dep of Object.keys(pkg.dependencies || {})) workspaceDeps.add(dep);
  }

  const rootPackageJson = JSON.parse(
    await fileSystem.readFile(path.join(rootDir, "package.json"), "utf8")
  );
  const runtimeDeps = [
    ...Object.keys(rootPackageJson.dependencies || {}),
    ...Object.keys(rootPackageJson.optionalDependencies || {})
  ].filter((dep) => !workspacePackageNames.has(dep));
  const externalSet = new Set([...runtimeDeps, ...workspaceDeps]);
  for (const name of workspacePackageNames) externalSet.delete(name);

  return {
    entryPoints: [path.join(rootDir, "src/index.ts")],
    alias,
    external: [...externalSet, "node:*"],
    workspacePackageNames
  };
}
