import path from "node:path";

const commandExportRecipes = {
  "./commands/op": { source: "./src/commands/op/index.ts", target: "es2022" },
  "./commands/pandoc": {
    source: "./src/commands/pandoc/index.ts", target: "node22",
    bundleDependenciesFrom: ["pandoc", "pdf"], require: true,
  },
};

export function resolveCommandExportBuilds(rootDir, source, root, workspaces, { alias, external, recipes = commandExportRecipes }) {
  const directory = path.join(rootDir, "packages/safe-bash");
  const builds = [];
  for (const [route, recipe] of Object.entries(recipes)) {
    if (!route.startsWith("./commands/") || route.includes("*") || route.slice(2).split("/").some(segment => !segment || segment === "." || segment === "..")) {
      throw new Error("Invalid command publication route: " + route);
    }
    const exported = source.exports?.[route];
    if (!exported) continue;
    for (const [label, value, prefix, suffix] of [
      ["source", recipe.source, "./src/commands/", ".ts"],
      ["output", exported.import, "./dist/commands/", ".js"],
    ]) {
      if (typeof value !== "string" || !value.startsWith(prefix) || !value.endsWith(suffix) ||
          value.includes("\\") || value.slice(2).split("/").some(segment => !segment || segment === "." || segment === "..")) {
        throw new Error(`Invalid command publication ${label}: ${route}`);
      }
    }
    const owned = new Set(workspaces.filter(({ dir }) => (recipe.bundleDependenciesFrom ?? []).includes(dir))
      .flatMap(({ pkg }) => Object.keys(pkg.dependencies ?? {}))
      .filter(name => !Object.hasOwn(root.dependencies ?? {}, name) && !Object.hasOwn(root.optionalDependencies ?? {}, name)));
    builds.push({
      absWorkingDir: rootDir, alias, external: external.filter(name => !owned.has(name)),
      entryPoints: [path.join(directory, recipe.source)], outfile: path.join(directory, exported.import),
      bundle: true, platform: "node", target: recipe.target, format: "esm", sourcemap: true, write: false,
      ...(recipe.require ? { banner: { js: 'import {createRequire as createCommandRequire} from "node:module"; const require = createCommandRequire(import.meta.url);' } } : {}),
    });
  }
  return builds;
}
