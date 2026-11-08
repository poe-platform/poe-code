# CLI startup native graph QA

1. Run the original Vitest control below independently from a temporary fixture in `scripts`, keeping the ten-second hook deadline and five-second test deadline.
2. Verify that every eagerly reachable CLI startup chunk, including the dynamically selected program entry, excludes filesystem implementation imports.
3. Execute the maintained normal build to verify the complete publication graph alongside this control.
4. Store temporary evidence under `out` and remove the temporary fixture after verification.

```ts
import path from "node:path";
import { build, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { resolveBundleGraph, resolveConsumerGraph } from "./bundle-graph.mjs";
import { canonicalFs } from "../packages/package-lint/src/bundle-policy.js";
import { readFile, readdir } from "node:fs/promises";

let result: BuildResult<{ metafile: true }>;

beforeAll(async () => {
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
  const consumer = resolveConsumerGraph(graph, canonicalFs);
  result = await build({
    entryPoints: [path.join(root, "src/cli-entry.ts"), path.join(root, "src/cli/program.ts")],
    ...consumer,
    plugins: [{
      name: "startup-imports",
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => args.kind === "dynamic-import"
          ? { path: args.path, external: true } : undefined);
      }
    }, ...(consumer.plugins ?? [])],
    bundle: true,
    platform: "node",
    format: "esm",
    splitting: true,
    outdir: path.join(root, "dist"),
    write: false,
    metafile: true,
    loader: { ".md": "text", ".mustache": "text", ".log": "text" }
  });
});

it("keeps filesystem imports out of the CLI startup graph", () => {
  const pending: string[] = [];
  const visited = new Set<string>();
  // Follow both startup entries, including the program loaded before parsing commands.
  for (const [filename, output] of Object.entries(result.metafile.outputs)) {
    if (output.entryPoint) pending.push(filename);
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
```
