import path from "node:path";
import { canonicalFs } from "../packages/package-lint/dist/bundle-policy.js";
import { declarationSource } from "./publish-declarations.mjs";

// Build each SDK together so independently selected formats share engine classes.
export function resolveSpreadsheetSdkBuilds(rootDir, consumerBuildOptions, packageJson) {
  const groups = new Map();
  for (const target of Object.values(packageJson.exports)) {
    const output = target?.import?.split("/");
    if (output?.[0] !== "." || output[1] !== "dist" || !["ssconvert", "csvkit"].includes(output[2])) continue;
    const source = path.relative(rootDir, declarationSource(rootDir, path.resolve(rootDir, target.types))).split(path.sep);
    source[source.indexOf("dist")] = "src";
    const entry = output.slice(3).join("/").slice(0, -".js".length);
    const entries = groups.get(output[2]) ?? {};
    entries[entry] = path.resolve(rootDir, source.join("/").slice(0, -".d.ts".length) + ".ts");
    groups.set(output[2], entries);
  }
  return [...groups].map(([name, entryPoints]) => ({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    ...consumerBuildOptions,
    entryPoints,
    outdir: path.join(rootDir, "dist", name),
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    external: [...Object.keys({ ...packageJson.dependencies, ...packageJson.optionalDependencies }), ...canonicalFs.routes.map(route => route.specifier)],
    sourcemap: true,
  }));
}
