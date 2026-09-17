import path from "node:path";
import { readFile } from "node:fs/promises";
import { build, type Metafile } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";
import { resolvePandocBuild } from "./bundle-safe-bash.mjs";
import { publishBundleOutputs } from "./publish-bundle.mjs";
import { findBundleIssues } from "../packages/package-lint/src/bundle-policy.js";
import { canonicalBundleFixture } from "../packages/package-lint/src/fixtures.js";

it("bundles the SDK's opt-in Pandoc import only after publishing its public target", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const specifier = "poe-code/safe-bash/commands/pandoc";
  const target = path.resolve(root, manifest.exports["./safe-bash/commands/pandoc"].import);
  const source = await readFile(path.join(root, "src/sdk/bash.ts"), "utf8");
  const volume = new Volume();
  const files = createFsFromVolume(volume).promises;
  const compile = (contents: string) => build({
    absWorkingDir: root,
    stdin: { contents, loader: "ts", resolveDir: root },
    outdir: path.join(root, "dist"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    write: false,
    metafile: true,
    external: ["poe-code/safe-fs/core"],
    alias: { [specifier]: "/unpublished-pandoc/public/command.js" },
    plugins: [{
      name: "published-modules-in-memory",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.path === specifier) {
            return volume.existsSync(target)
              ? { path: target, namespace: "published" }
              : undefined;
          }
          if (["poe-code/safe-bash", "poe-code/safe-bash/commands/python/node"].includes(args.path)) {
            return { path: args.path, namespace: "shell-fixture" };
          }
          if (args.namespace === "published" && args.path.startsWith(".")) {
            return { path: path.resolve(args.resolveDir, args.path), namespace: "published" };
          }
          return undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "published" }, async args => ({
          contents: await files.readFile(args.path, "utf8") as string,
          resolveDir: path.dirname(args.path)
        }));
        builder.onLoad({ filter: /.*/, namespace: "shell-fixture" }, () => ({
          contents: "export const Shell = class {}; export const RealFileSystem = class {}; export const agentCommands = () => {}; export const pythonCommands = () => {}; export const createNodePythonWorker = () => {};"
        }));
      }
    }]
  });
  const fixture = canonicalBundleFixture();
  const issues = (metafile: Metafile) => findBundleIssues(fixture.manifest, new Set(), {
    ...fixture.metafile,
    outputs: { ...fixture.metafile.outputs, ...metafile.outputs }
  }, fixture.packed);

  const cold = await compile(source);
  expect(issues(cold.metafile!)).toEqual([{ external: specifier, reason: "workspace-not-inlined" }]);

  const options = resolvePandocBuild(root);
  await files.mkdir(path.dirname(options.outdir), { recursive: true });
  const converter = await build({
    ...options,
    plugins: [...options.plugins, {
      name: "converter-fixture",
      setup(builder) {
        builder.onLoad({ filter: /.*/ }, args => {
          if (args.path === options.entryPoints.sdk) {
            return { contents: "globalThis.pandocLoaded = true; export const convert = () => 'converted';" };
          }
          if (args.path === options.entryPoints.command) {
            return {
              contents: `import { convert } from ${JSON.stringify(options.entryPoints.sdk)}; export const pandocCommands = () => convert();`,
              resolveDir: root
            };
          }
          return undefined;
        });
      }
    }]
  });
  await publishBundleOutputs(converter, {
    outdir: options.outdir,
    entryPoints: Object.values(options.entryPoints),
    workingDirectory: root
  }, files);
  expect(volume.existsSync(target)).toBe(true);

  const ready = await compile(source);
  expect(issues(ready.metafile!)).toEqual([]);
  const outputs = ready.metafile!.outputs;
  const command = Object.entries(outputs).find(([, output]) => output.entryPoint === `published:${target}`)!;
  expect(command).toBeDefined();
  expect(Object.values(outputs).flatMap(output => output.imports)).toContainEqual({
    path: command[0], kind: "dynamic-import"
  });
  const pending = Object.entries(outputs)
    .filter(([, output]) => output.entryPoint === "<stdin>" || output.entryPoint?.startsWith("shell-fixture:"))
    .map(([filename]) => filename);
  expect(pending.length).toBeGreaterThan(0);
  const eager = new Set<string>();
  while (pending.length) {
    const filename = pending.pop()!;
    if (eager.has(filename)) continue;
    eager.add(filename);
    for (const dependency of outputs[filename].imports) {
      if (!dependency.external && dependency.kind !== "dynamic-import") pending.push(dependency.path);
    }
  }
  expect([...eager].flatMap(filename => Object.keys(outputs[filename].inputs))
    .filter(filename => filename.startsWith("published:"))).toEqual([]);
  expect(eager.has(command[0])).toBe(false);

  const arbitrary = await compile(`${source}\nexport async function probe() { try { return await import("poe-code/arbitrary-self-import"); } catch {} }`);
  expect(issues(arbitrary.metafile!)).toEqual([
    { external: "poe-code/arbitrary-self-import", reason: "workspace-not-inlined" }
  ]);
});
