import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Compile in memory before starting the behavioral deadline in the child. */
export async function bundleProbe(entry: URL): Promise<string> {
  const privateWorkspaces = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).poeCode.integration.privateWorkspaces;
  const sourceAliases = {
    "safe-bash-contracts": fileURLToPath(new URL("../../../safe-bash-contracts/src", import.meta.url)),
    "@poe-code/safe-fs": fileURLToPath(new URL("../../../safe-fs/src", import.meta.url)),
  };
  const result = await build({
    entryPoints: [fileURLToPath(entry)], bundle: true, packages: "external", platform: "node",
    alias: {
      ...Object.fromEntries(Object.keys(privateWorkspaces).filter(name => !Object.hasOwn(sourceAliases, name)).flatMap(name => {
        const directory = name.startsWith("@") ? name.split("/")[1]! : name;
        const root = new URL(`../../../${directory}/`, import.meta.url);
        const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
        return Object.entries(manifest.exports as Record<string, string | { import: string }>).map(([route, target]) => [
          route === "." ? name : name + route.slice(1),
          fileURLToPath(new URL(typeof target === "string" ? target : target.import, root)),
        ]);
      })),
      ...sourceAliases,
    },
    format: "esm", target: "node22", write: false, minify: true, keepNames: true,
  });
  return result.outputFiles[0]!.text;
}
