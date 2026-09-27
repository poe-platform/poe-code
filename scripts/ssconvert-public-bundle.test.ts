import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import glob from "fast-glob";
import { beforeAll, expect, it } from "vitest";
import { canonicalFs, collectPackageFiles } from "../packages/package-lint/src/bundle-policy.js";
import { resolveBundleGraph, resolveConsumerGraph, resolveSharedRuntimeBuilds } from "./bundle-graph.mjs";
import { resolveSpreadsheetSdkBuilds } from "./bundle-spreadsheets.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
it.each([
  ["public", "poe-code/ssconvert", "poe-code/safe-bash/contracts", "poe-code/safe-fs/core"],
  ["workspace", "safe-bash-command-ssconvert", "safe-bash-contracts", "@poe-code/safe-fs/core"]
])("shares raw arguments and frozen cleanup budgets in the %s SDK graph", async (_profile, sdk, contracts, filesystem) => {
  const result = await build({
    stdin: {
      contents: `
        import { createSsconvertCommands } from ${JSON.stringify(sdk)};
        import { bindFileOutputBudget, createCommandArguments, shellValueFromBytes } from ${JSON.stringify(contracts)};
        import { MemoryFileSystem } from ${JSON.stringify(filesystem)};
        globalThis.result = (async () => {
          const observations = [];
          for (const mode of ["allowed", "limited", "cancelled"]) {
            const fs = new MemoryFileSystem();
            const controller = new AbortController();
            const refusal = new Error("file output limit");
            const cleanups = [], diagnostics = [];
            let admitted = 0;
            const context = { command: "ssconvert", fs, cwd: "/", env: {}, signal: controller.signal,
              args: ["-I", "Gnumeric_stf:stf_csvtab", "-T", "Gnumeric_stf:stf_csv", "fd://0", "/result.csv"],
              stdin: [new TextEncoder().encode("Name,Value\\nexample,7\\n")], stdinIsDefault: false,
              stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(bytes); } },
              registerCleanup: Object.freeze(cleanup => cleanups.push(cleanup)) };
            bindFileOutputBudget(context, sink => ({ async write(bytes) {
              admitted += bytes.length;
              if (mode === "cancelled") { controller.abort(false); throw false; }
              if (mode === "limited") throw refusal;
              await sink.write(bytes);
            } }));
            let exitCode, cancelled = false, refused = false;
            try { exitCode = (await createSsconvertCommands()[0].execute(context)).exitCode; }
            catch (error) {
              if (error === false) cancelled = true;
              else if (error === refusal) refused = true;
              else throw error;
            }
            if (mode === "allowed" && exitCode !== 0)
              throw new Error(diagnostics.map(bytes => new TextDecoder().decode(bytes)).join(""));
            await Promise.all(cleanups.map(cleanup => cleanup()));
            const files = (await fs.readdir("/")).map(entry => entry.name);
            const output = files.includes("result.csv") ? new TextDecoder().decode(await fs.readFile("/result.csv")) : null;
            observations.push({ mode, admitted, exitCode, cancelled, refused, files, output });
          }
          const diagnostics = [];
          const raw = new Uint8Array([45, 45, 255]);
          const carrier = createCommandArguments([shellValueFromBytes(raw)]);
          raw.fill(0);
          const result = await createSsconvertCommands()[0].execute({ command: "ssconvert",
            args: carrier.args, argumentValues: carrier, fs: new MemoryFileSystem(), cwd: "/", env: {},
            signal: new AbortController().signal, stdin: [], stdinIsDefault: true,
            stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(...bytes); } } });
          return { observations, rawExit: result.exitCode, diagnostic: new TextDecoder().decode(new Uint8Array(diagnostics)) };
        })();`,
      resolveDir: new URL("../", import.meta.url).pathname,
    },
    bundle: true, platform: "browser", format: "iife", write: false,
    // Root public artifacts are built independently of private workspace outputs.
    // The VM compiles the same canonical portable filesystem source because a
    // workspace SafeJS rebuild can remove that root-generated filesystem entry.
    alias: { [filesystem]: new URL("../packages/safe-fs/src/core.ts", import.meta.url).pathname },
  });
  const worker: Record<string, unknown> = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, AbortSignal, URL, URLSearchParams, atob, crypto: webcrypto, setTimeout, clearTimeout, queueMicrotask };
  runInNewContext(result.outputFiles[0]!.text, worker);
  const actual = await worker.result as { observations: unknown[]; rawExit: number; diagnostic: string };
  expect(actual.observations).toEqual([
    { mode: "allowed", admitted: 21, exitCode: 0, cancelled: false, refused: false, files: ["result.csv"], output: "Name,Value\nexample,7\n" },
    { mode: "limited", admitted: 21, exitCode: undefined, cancelled: false, refused: true, files: [], output: null },
    { mode: "cancelled", admitted: 21, exitCode: undefined, cancelled: true, refused: false, files: [], output: null },
  ]);
  expect(actual.rawExit).toBe(1);
  expect(actual.diagnostic).toContain("[Invalid UTF-8] Unknown option --\\xff\n");
});



let result: Awaited<ReturnType<typeof build>>;
let packed: Set<string>;
beforeAll(async () => {
  const packages = glob.sync(manifest.workspaces.map((workspace: string) => `${workspace}/package.json`), { cwd: root })
    .map(file => ({
      dir: relative(resolve(root, "packages"), dirname(resolve(root, file))),
      pkg: JSON.parse(readFileSync(resolve(root, file), "utf8"))
    }));
  const shared = packages.filter(({ pkg }) => pkg.poeCode?.bundle?.sharedRuntime === true)
    .map(({ dir, pkg }) => ({ directory: resolve(root, "packages", dir), outdir: resolve(root, "dist/shared", dir), pkg }));
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
