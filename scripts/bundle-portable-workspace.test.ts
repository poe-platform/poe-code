import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { resolveBundleGraph } from "./bundle-graph.mjs";

it.each([
  ["workerd", "safe-bash-command-mcp"],
  ["browser", "safe-bash-command-mcp"],
  ["workerd", "@poe-code/safe-js"],
  ["browser", "@poe-code/image-ast"],
])("keeps desktop OAuth outside the %s %s workspace bundle", async (condition, entry) => {
  const root = path.resolve(import.meta.dirname, "..");
  const packages = [];
  for (const dir of await readdir(path.join(root, "packages"))) {
    try {
      packages.push({ dir, pkg: JSON.parse(await readFile(path.join(root, "packages", dir, "package.json"), "utf8")) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const graph = await resolveBundleGraph(root, packages, undefined, [condition]);
  const result = await build({
    alias: graph.alias, external: graph.external,
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: root },
    bundle: true, platform: "neutral", mainFields: ["module", "main"], conditions: [condition], format: "esm",
    write: false, metafile: true, logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(filename => filename.includes("loopback-authorization") || filename.includes("auth-store/"))).toBe(false);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)
    .filter(entry => entry.path.startsWith("node:"))).toEqual([]);
  if (entry === "safe-bash-command-mcp") {
    expect(result.outputFiles[0]!.text).toContain("prepareRemoteMcpAuthorization");
  }
  for (const name of ["safe-bash-command-mcp", "mcp-oauth", "tiny-mcp-client"]) {
    expect(graph.alias[name]).toBe(path.join(root, "packages", name, "src/index.browser.ts"));
  }
  expect(graph.alias["@poe-code/safe-js/cli"]).toBeUndefined();
});
