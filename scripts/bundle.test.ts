import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { BuildOptions, BuildResult } from "esbuild";
import { expect, it, vi } from "vitest";
import { resolveConsumerGraph } from "./bundle-graph.mjs";

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
