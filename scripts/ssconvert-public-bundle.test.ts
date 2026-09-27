import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import glob from "fast-glob";
import { beforeAll, expect, it } from "vitest";
import { canonicalFs, collectPackageFiles } from "../packages/package-lint/src/bundle-policy.js";
import { resolveBundleGraph, resolveConsumerGraph, resolveSharedRuntimeBuilds } from "./bundle-graph.mjs";
import { resolveSpreadsheetSdkBuilds } from "./bundle-spreadsheets.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
let result: Awaited<ReturnType<typeof build>>;
let packed: Set<string>;
beforeAll(async () => {
  const packages = glob.sync(manifest.workspaces.map((workspace: string) => `${workspace}/package.json`), { cwd: root })
    .map(file => ({
      dir: relative(resolve(root, "packages"), dirname(resolve(root, file))),
      pkg: JSON.parse(readFileSync(resolve(root, file), "utf8"))
    }));
  const shared = packages.filter(({ pkg }) => pkg.poeCode?.bundle?.sharedRuntime === true)
    .map(({ dir, pkg }) => ({ directory: resolve(root, "packages", dir), pkg }));
  const workspaceGraph = await resolveBundleGraph(root, packages);
  const graph = resolveConsumerGraph(workspaceGraph, canonicalFs, shared);
  const entryPoint = resolve(root, manifest.exports["./ssconvert"].import);
  const options = resolveSpreadsheetSdkBuilds(root, { ...graph, absWorkingDir: root }, manifest)
    .find(options => options.outfile === entryPoint)!;
  expect(options).toBeDefined();
  const artifacts = new Map<string, string>();
  for (const recipe of [...resolveSharedRuntimeBuilds(workspaceGraph, canonicalFs, shared), options]) {
    const published = await build({ ...recipe, write: false });
    for (const output of published.outputFiles!) artifacts.set(output.path, output.text);
  }
  result = await build({
    entryPoints: [entryPoint],
    outfile: entryPoint,
    bundle: true,
    external: [...Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }), ...canonicalFs.routes.map(route => route.specifier)],
    platform: "node",
    target: "node22",
    format: "esm",
    write: false,
    metafile: true,
    plugins: [{ name: "published-spreadsheet-sdk", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        // The publication directory may exist only in memory. Preserve every
        // bare import for dependency validation without disk-based resolution.
        if (args.kind !== "entry-point" && !args.path.startsWith(".") && !isAbsolute(args.path)) {
          return { path: args.path, external: true };
        }
        const target = resolve(args.resolveDir, args.path);
        return artifacts.has(target) ? { path: target } : undefined;
      });
      builder.onLoad({ filter: /\.js$/ }, args => artifacts.has(args.path)
        ? { contents: artifacts.get(args.path), loader: "js", resolveDir: dirname(args.path) }
        : undefined);
    } }],
  });
  packed = await collectPackageFiles(root, manifest.files, {
    readdir: directory => readdir(directory, { withFileTypes: true }), stat
  });
}, 30_000);

it("starts the bundled spreadsheet SDK in a Worker without Node module initialization", () => {
  const compiled = readFileSync(new URL("../packages/safe-bash-command-ssconvert/dist/testing/worker-runtime-fixture.js", import.meta.url), "utf8");
  const worker: Record<string, unknown> = { TextEncoder, TextDecoder, atob, AbortController, AbortSignal };
  runInNewContext(compiled, worker);
  expect(worker.snapshot).toEqual({});
  expect(Object.isFrozen(worker.snapshot)).toBe(true);
  expect(worker.command).toMatchObject({ name: "ssconvert", execute: expect.any(Function) });
});

it("ships the spreadsheet SDK without unavailable private runtime dependencies", () => {
  const available = new Set(Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }));
  const imports = Object.entries(result.metafile!.outputs).flatMap(([filename, output]) => output.imports.map(entry => ({ ...entry, filename })));
  const unavailable = imports
    .filter(entry => entry.external && !entry.path.startsWith("node:"))
    .filter(entry => {
      if (entry.path.startsWith(".")) {
        return !packed.has(relative(root, resolve(root, dirname(entry.filename), entry.path)));
      }
      if (entry.path !== manifest.name && !entry.path.startsWith(`${manifest.name}/`)) return true;
      const key = entry.path === manifest.name ? "." : `.${entry.path.slice(manifest.name.length)}`;
      return !Object.hasOwn(manifest.exports, key);
    })
    .map(entry => entry.path.startsWith("@") ? entry.path.split("/").slice(0, 2).join("/") : entry.path.split("/")[0])
    .filter(name => !available.has(name));
  expect([...new Set(unavailable)]).toEqual([]);
});
