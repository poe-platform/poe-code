import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { resolveBundleGraph, resolveConsumerGraph } from "./bundle-graph.mjs";
import { canonicalFs } from "../packages/package-lint/src/bundle-policy.js";
import { readFile, readdir } from "node:fs/promises";

it("keeps filesystem imports out of the CLI startup graph", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const workspaces = [];
  for (const entry of await readdir(path.join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    try {
      workspaces.push({
        dir,
        pkg: JSON.parse(await readFile(path.join(root, "packages", dir, "package.json"), "utf8"))
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const graph = await resolveBundleGraph(root, workspaces);
  const result = await build({
    entryPoints: [path.join(root, "src/index.ts")],
    ...resolveConsumerGraph(graph, canonicalFs),
    bundle: true,
    platform: "node",
    format: "esm",
    splitting: true,
    outdir: path.join(root, "dist"),
    write: false,
    metafile: true,
    loader: { ".md": "text", ".mustache": "text", ".log": "text" }
  });
  const pending = ["dist/index.js"];
  const visited = new Set<string>();
  // Include the CLI program, which main loads dynamically before parsing commands.
  for (const [filename, output] of Object.entries(result.metafile.outputs)) {
    if (output.entryPoint?.endsWith("src/cli/program.ts")) pending.push(filename);
  }
  while (pending.length) {
    const filename = pending.pop()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    for (const item of result.metafile.outputs[filename]!.imports) {
      if (item.kind === "dynamic-import") continue;
      expect(item.path, filename).not.toContain("safe-fs");
      if (!item.external) pending.push(item.path);
    }
  }
});
