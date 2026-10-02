import path from "node:path";

/** Derive facade bindings from real browser builds, including nested owners. */
export function privateRuntimeExportResolver(rootDir, external, files, recipe, bundle) {
  let prepared;
  return async specifier => {
    if (!external.some(name => specifier === name || specifier.startsWith(name + "/"))) return undefined;
    prepared ??= (async () => {
      const profiles = JSON.parse(await files.readFile(path.join(rootDir, "packages/safe-bash/package.json"), "utf8")).poeCode.integration.privateWorkspaces;
      const entries = new Map();
      for (const name of Object.keys(profiles)) {
        const directory = path.join(rootDir, "packages", name.startsWith("@") ? name.split("/")[1] : name);
        const pkg = JSON.parse(await files.readFile(path.join(directory, "package.json"), "utf8"));
        for (const [route, target] of Object.entries(pkg.exports ?? {})) {
          if (typeof target.import !== "string" || !target.import.startsWith("./dist/")) throw new Error("Unqualified private export: " + name + " " + route);
          const input = pkg.poeCode?.bundle?.prebuilt === true
            ? target.import : "./src/" + target.import.slice("./dist/".length, -3) + ".ts";
          entries.set(name + (route === "." ? "" : route.slice(1)), path.resolve(directory, input));
        }
      }
      const result = await bundle({ ...recipe, entryPoints: Object.fromEntries(entries), outdir: path.join(rootDir, "packages/safe-bash/dist"),
        external: recipe.external.filter(item => !Object.keys(profiles).some(owner => item === owner || item.startsWith(owner + "/"))),
        metafile: true, sourcemap: false, write: false,
      });
      const outputs = new Map(Object.values(result.metafile.outputs).filter(output => output.entryPoint)
        .map(output => [path.resolve(rootDir, output.entryPoint), output.exports]));
      return new Map([...entries].map(([route, filename]) => [route, outputs.get(filename)]));
    })();
    const exports = await prepared;
    return exports.get(specifier);
  };
}
