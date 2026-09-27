import path from "node:path";
import { canonicalFs } from "../packages/package-lint/dist/bundle-policy.js";

// Public spreadsheet SDKs inline their engines while sharing invocation contracts.
export function resolveSpreadsheetSdkBuilds(rootDir, consumerBuildOptions, packageJson) {
  return [["safe-bash-command-csvkit", ["index", "codecs/utf8", "codecs/python"]], ["safe-bash-command-ssconvert", ["index"]]]
    .flatMap(([workspace, entries]) => entries.map(entryPoint => ({
      entryPoints: [path.join(rootDir, "packages", workspace, "src", entryPoint + ".ts")],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outfile: path.join(rootDir, "packages", workspace, "dist", entryPoint + ".js"),
      ...consumerBuildOptions,
      external: [...Object.keys({ ...packageJson.dependencies, ...packageJson.optionalDependencies }), ...canonicalFs.routes.map(route => route.specifier)],
      sourcemap: true,
    })));
}
