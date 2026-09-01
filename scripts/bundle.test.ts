import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type { BuildOptions, BuildResult, Metafile, OutputFile } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, expect, it, vi } from "vitest";
import { resolveConsumerGraph } from "./bundle-graph.mjs";
import { canonicalBundleFixture } from "../packages/package-lint/src/fixtures.js";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("esbuild");
  vi.doUnmock("../packages/package-lint/dist/bundle-policy.js");
  vi.doUnmock("./bundle-assets.mjs");
  vi.resetModules();
});

it.each([
  { external: "poe-code/safe-fs", invalidExternal: false },
  { external: "node:nonexistent", invalidExternal: true },
  { external: "node:sqlite", invalidExternal: false }
])(
  "validates all isolated root bundle groups before saving canonical evidence ($external)",
  async ({ external, invalidExternal }) => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const experimentAssets = {
      "default-instructions.md": "- Commit: `{{commit_command}}`\n",
      "default-run.yaml": "prompt: '{{body}}'\n"
    };
    const fixture = canonicalBundleFixture();
    const volume = Volume.fromJSON({
      [path.join(root, "package.json")]: JSON.stringify(fixture.manifest),
      ...Object.fromEntries(Object.entries(experimentAssets).map(([name, content]) => [
        path.join(root, "packages/experiment-loop/src/config", name), content
      ])),
      ...Object.fromEntries(
        Object.entries(fixture.metafile.canonicalTypes).map(([filename, imports]) => [
          path.join(root, filename),
          imports.length
            ? imports.map((specifier) => `export * from "${specifier}";`).join("\n")
            : "export {};\n"
        ])
      ),
      [path.join(root, "src/providers/proof.ts")]: "export {};"
    });
    for (const name of ["safe-fs", "safe-js", "safe-bash", "memory", "agent-mcp-config", "agent-skill-config"]) {
      volume.mkdirSync(path.join(root, "packages", name, "dist"), { recursive: true });
      volume.writeFileSync(
        path.join(root, "packages", name, "package.json"),
        JSON.stringify({ name: `@poe-code/${name}` })
      );
    }
    const files = createFsFromVolume(volume).promises;
    const build = vi.fn(async (options: BuildOptions) => {
      const entries = Array.isArray(options.entryPoints)
        ? options.entryPoints.map((entry) => {
            const filename = typeof entry === "string" ? entry : entry.in;
            return [path.parse(filename).name, filename];
          })
        : Object.entries(options.entryPoints ?? {});
      const metafile: Metafile = { inputs: {}, outputs: {} };
      if (options.splitting)
        metafile.inputs[`packages/safe-fs/src/platform/${options.platform}.ts`] = {
          bytes: 0,
          imports: []
        };
      const outputFiles: OutputFile[] = [];
      for (const [name, source] of entries) {
        const output = options.outfile ?? path.join(options.outdir!, `${name}.js`);
        const input = path.relative(root, source);
        metafile.inputs[input] = { bytes: 0, imports: [] };
        for (const suffix of ["", ".map"]) {
          const filename = output + suffix;
          const relative = path.relative(root, filename);
          metafile.outputs[relative] = {
            bytes: 0,
            exports: [],
            inputs: suffix ? {} : { [input]: { bytesInOutput: 0 } },
            imports: []
          };
          if (!suffix) {
            metafile.outputs[relative].entryPoint = input;
            if (!options.splitting)
              metafile.outputs[relative].imports.push({
                path: external,
                external: true,
                kind: "import-statement"
              });
          }
          const contents = new Uint8Array();
          outputFiles.push({ path: filename, contents, text: "", hash: "fixture" });
          if (options.write !== false) {
            await files.mkdir(path.dirname(filename), { recursive: true });
            await files.writeFile(filename, contents);
          }
        }
      }
      return { metafile, outputFiles };
    });
    vi.doMock("node:fs/promises", () => ({
      ...files,
      cp: vi.fn(async () => {}),
      copyFile: vi.fn(async (source: string, destination: string) => {
        if (path.dirname(source) === path.join(root, "packages/experiment-loop/src/config")) {
          await files.copyFile(source, destination);
        }
      })
    }));
    vi.doMock("esbuild", () => ({ build }));
    vi.doMock("./bundle-assets.mjs", () => ({ resolveGithubWorkflowAssetCopies: () => [] }));
    vi.doMock(
      "../packages/package-lint/dist/bundle-policy.js",
      () => import("../packages/package-lint/src/bundle-policy.js")
    );
    if (invalidExternal) {
      await expect(import("./bundle.mjs")).rejects.toThrow("invalid-external");
      expect(volume.existsSync(path.join(root, "dist/metafile.json"))).toBe(false);
    } else {
      await import("./bundle.mjs");
      for (const [name, content] of Object.entries(experimentAssets)) {
        expect(await files.readFile(path.join(root, "dist", name), "utf8")).toBe(content);
      }
      const evidence = JSON.parse(
        volume.readFileSync(path.join(root, "dist/metafile.json"), "utf8") as string
      );
      expect(evidence.canonicalBundle.entryPoints).toContain("packages/safe-fs/src/index.ts");
      expect(evidence.outputs["packages/superintendent/dist/mcp.js"].imports[0].path).toBe(
        external
      );
      expect(volume.existsSync(path.join(root, "packages/safe-js/dist/safe-fs.js"))).toBe(true);
    }
    for (const [options] of build.mock.calls) {
      if (options.splitting) continue;
      if (options.platform === "browser") {
        expect(options.alias!["poe-code/safe-fs"]).toBe("poe-code/safe-fs/core");
      } else {
        expect(options.alias!["@poe-code/safe-fs"]).toBe("poe-code/safe-fs");
      }
      expect(options.metafile).toBe(true);
    }
  }
);

it("preserves the previous SafeJS bundle when compilation fails", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const previousChunk = path.join(root, "packages/safe-js/dist/chunks/chunk-OLD.js");
  const volume = Volume.fromJSON({
    [path.join(root, "package.json")]: "{}",
    [path.join(root, "packages/safe-js/package.json")]: '{"name":"@poe-code/safe-js"}',
    [path.join(root, "packages/safe-fs/package.json")]:
      '{"name":"@poe-code/safe-fs","exports":{"./node":{"import":"./dist/node/index.js"}}}',
    [path.join(root, "packages/memory/package.json")]: '{"name":"@poe-code/memory"}',
    [path.join(root, "packages/safe-js/dist/index.js")]: 'export * from "./chunks/chunk-OLD.js";',
    [previousChunk]: "export const previous = true;",
    [path.join(root, "dist/metafile.json")]: "{}"
  });
  volume.mkdirSync(path.join(root, "src/providers"), { recursive: true });
  const failure = new Error("SafeJS compilation failed");
  const build = vi.fn(async (options: BuildOptions) => {
    if (options.outdir === path.join(root, "packages/safe-js/dist")) throw failure;
    return { metafile: { outputs: {} } };
  });
  vi.doMock("node:fs/promises", () => createFsFromVolume(volume).promises);
  vi.doMock("esbuild", () => ({ build }));
  vi.doMock(
    "../packages/package-lint/dist/bundle-policy.js",
    () => import("../packages/package-lint/src/bundle-policy.js")
  );

  await expect(import("./bundle.mjs")).rejects.toBe(failure);

  expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ write: false, metafile: true }));
  const producer = build.mock.calls.at(-1)![0];
  expect((producer.entryPoints as Record<string, string>)["safe-fs"]).toBe(
    path.join(root, "packages/safe-fs/src/index.ts")
  );
  expect(producer.alias!["@poe-code/safe-fs/node"]).toBe(
    path.join(root, "packages/safe-fs/src/node-host.ts")
  );
  for (const [options] of build.mock.calls.slice(0, -1)) {
    expect(options.alias!["@poe-code/safe-fs"]).toBe("poe-code/safe-fs");
    expect(options.alias!["@poe-code/safe-fs/node"]).toBe("poe-code/safe-fs/node");
    expect(options.external).toContain("poe-code/safe-fs");
    expect(options.metafile).toBe(true);
  }
  expect(volume.existsSync(previousChunk)).toBe(true);
  expect(volume.readFileSync(previousChunk, "utf8")).toBe("export const previous = true;");
});

it("shares frozen FS constructors and authority registries across producer entries and an external consumer", async () => {
  const esbuild = await vi.importActual<typeof import("esbuild")>("esbuild");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(import.meta.url);
  const outdir = "/isolated/packages/safe-js/dist";
  const common: BuildOptions = {
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    write: false,
    metafile: true
  };
  const producer = await esbuild.build({
    ...common,
    splitting: true,
    outdir,
    entryPoints: {
      "safe-fs": path.join(root, "packages/safe-fs/src/index.ts"),
      core: path.join(root, "packages/safe-fs/src/fs/memory/index.ts"),
      cli: path.join(root, "packages/safe-fs/src/fs/readonly/index.ts")
    }
  });
  const sourceGraph = {
    alias: { "@poe-code/safe-fs": path.join(root, "packages/safe-fs/src/index.ts") },
    external: ["node:*"]
  };
  const consumer = await esbuild.build({
    ...common,
    ...resolveConsumerGraph(sourceGraph, {
      workspace: "@poe-code/safe-fs",
      specifier: "poe-code/safe-fs"
    }),
    stdin: { contents: 'export * from "@poe-code/safe-fs";', resolveDir: root },
    outfile: "/isolated/safe-bash.js"
  });
  const duplicate = await esbuild.build({
    ...common,
    ...sourceGraph,
    stdin: { contents: 'export * from "@poe-code/safe-fs";', resolveDir: root },
    outfile: "/isolated/duplicate.js"
  });
  type PublicFs = typeof import("../packages/safe-fs/src/index.js");
  async function modules(results: BuildResult[]) {
    const compiled = new Map<string, string>();
    for (const result of results) {
      for (const output of result.outputFiles!) {
        compiled.set(
          output.path,
          (await esbuild.transform(output.text, { format: "cjs", target: "node18" })).code
        );
      }
    }
    const cache = new Map<string, { exports: PublicFs }>();
    function load(filename: string): PublicFs {
      const existing = cache.get(filename);
      if (existing) return existing.exports;
      const module = { exports: {} as PublicFs };
      cache.set(filename, module);
      const code = compiled.get(filename);
      if (code === undefined) throw new Error(`Missing fixture output: ${filename}`);
      new Function("module", "exports", "require", code)(
        module,
        module.exports,
        (specifier: string) => {
          if (specifier === "poe-code/safe-fs") return load(`${outdir}/safe-fs.js`);
          if (specifier.startsWith("."))
            return load(path.resolve(path.dirname(filename), specifier));
          return require(specifier);
        }
      );
      return module.exports;
    }
    return load;
  }
  const load = await modules([producer, consumer, duplicate]);
  const publicFs = load(`${outdir}/safe-fs.js`);
  const bash = load("/isolated/safe-bash.js");
  const duplicated = load("/isolated/duplicate.js");
  expect(bash.FsError).toBe(publicFs.FsError);
  expect(load(`${outdir}/core.js`).MemoryFileSystem).toBe(publicFs.MemoryFileSystem);
  expect(load(`${outdir}/cli.js`).ReadOnlyFileSystem).toBe(publicFs.ReadOnlyFileSystem);
  expect(duplicated.FsError).not.toBe(publicFs.FsError);
  expect(new duplicated.FsError("ENOENT") instanceof publicFs.FsError).toBe(false);
  const memory = new publicFs.MemoryFileSystem();
  await memory.writeFile("/local", new Uint8Array([1]));
  const remote = new bash.S3FileSystem({
    bucket: "proof",
    transport: new bash.MockS3Client({ buckets: ["proof"] })
  });
  await remote.writeFile("/remote", new Uint8Array([2]));
  expect(await memory.compareEntry("/local", remote, "/remote")).toBe("distinct");
  expect(await memory.compareEntry("/local", new bash.ReadOnlyFileSystem(remote), "/remote")).toBe(
    "distinct"
  );
  const duplicateRemote = new duplicated.S3FileSystem({
    bucket: "proof",
    transport: new duplicated.MockS3Client({ buckets: ["proof"] })
  });
  await duplicateRemote.writeFile("/remote", new Uint8Array([3]));
  expect(await memory.compareEntry("/local", duplicateRemote, "/remote")).toBe("unknown");
  await expect(memory.readFile("/missing")).rejects.toBeInstanceOf(bash.FsError);
  expect(
    Object.keys(consumer.metafile!.inputs).some((filename) =>
      filename.includes("packages/safe-fs/src/")
    )
  ).toBe(false);
});

it.each(["success", "runtime-failure", "type-failure"])(
  "runs the canonical public/type smoke without a pack or install: %s",
  (outcome) => {
    const filename = path.join(path.dirname(fileURLToPath(import.meta.url)), "smoke-test.ts");
    const parsed = ts.createSourceFile(
      filename,
      readFileSync(filename, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const declaration = parsed.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "runSafeFsImportSmoke"
    );
    expect(declaration).toBeDefined();
    const source = ts.transpileModule(declaration!.getText(parsed), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const files = new Map<string, string>();
    const spawnSync = vi.fn(() => ({
      status: outcome === "runtime-failure" ? 1 : 0,
      stdout: "",
      stderr: ""
    }));
    const createProgram = vi.fn(() => ({}));
    const compiler = {
      ...ts,
      createProgram,
      getPreEmitDiagnostics: () =>
        outcome === "type-failure" ? [{ messageText: "unresolved private type" }] : []
    };
    const runSmoke = new Function(
      "writeFileSync",
      "spawnSync",
      "ts",
      "path",
      "process",
      "console",
      "verbose",
      `${source}; return runSafeFsImportSmoke;`
    )(
      (name: string, value: string) => files.set(name, value),
      spawnSync,
      compiler,
      path,
      process,
      { log: vi.fn() },
      false
    );
    expect(runSmoke("/isolated/consumer")).toBe(outcome === "success");
    expect(spawnSync).toHaveBeenCalledOnce();
    if (outcome === "success") {
      expect(createProgram).toHaveBeenCalledTimes(2);
      for (const [, options] of createProgram.mock.calls as unknown as [
        string[],
        ts.CompilerOptions
      ][]) {
        expect(options).toMatchObject({ strict: true, skipLibCheck: false, noEmit: true });
        expect(options.paths).toBeUndefined();
        expect(options.baseUrl).toBeUndefined();
      }
      expect([...files.values()].some((text) => text.includes('from "poe-code/safe-fs"'))).toBe(
        true
      );
    }
  }
);
