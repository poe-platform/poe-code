import path from "node:path";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { build, transformSync, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { resolvePrivateCommandBuild } from "./bundle-safe-bash.mjs";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "packages/pdf-ast/package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(root, "packages/safe-bash/package.json"), "utf8"));
let artifact: BuildResult;

beforeAll(async () => {
  const recipe = resolvePrivateCommandBuild(root,
    { [pkg.name]: manifest.poeCode.integration.privateWorkspaces[pkg.name] },
    [{ dir: "pdf-ast", pkg }],
    { alias: {}, external: ["@poe-code/safe-fs", "@poe-code/safe-fs/*"], portable: true });
  artifact = await build({ ...recipe, sourcemap: false, metafile: true });
});

it.each([
  { name: "cosNull", budget: 512, arguments: [], expected: { kind: "null" } },
  { name: "formatExtractedPageText", budget: 4096,
    arguments: [{ pageIndex: 0, width: 100, height: 100, blocks: [], tables: [] }], expected: "" },
])("tree-shakes the published PDF graph for $name", async probe => {
  const files = new Map(artifact.outputFiles!.map(file => [file.path, file.text]));
  const result = await build({
    stdin: { contents: `export { ${probe.name} } from "./packages/pdf-ast/dist/index.js";`, resolveDir: root },
    bundle: true, write: false, minify: true, format: "esm", metafile: true,
    plugins: [{ name: "published-pdf-graph", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const target = path.resolve(args.resolveDir, args.path);
        if (!files.has(target)) return { path: args.path, external: true };
        return { path: target, namespace: "artifact", sideEffects:
          target.includes("/pdf-ast/") ? pkg.sideEffects !== false : false };
      });
      builder.onLoad({ filter: /.*/, namespace: "artifact" }, args => ({
        contents: files.get(args.path)!, resolveDir: path.dirname(args.path),
      }));
    } }],
  });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(result.outputFiles![0]!.contents.length).toBeLessThan(probe.budget);
  const context = { pdf: undefined as Record<string, (...args: unknown[]) => unknown> | undefined };
  runInNewContext(transformSync(result.outputFiles![0]!.text, { format: "iife", globalName: "pdf" }).code, context);
  expect(context.pdf![probe.name]!(...probe.arguments)).toEqual(probe.expected);
});
