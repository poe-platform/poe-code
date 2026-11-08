import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { build, type BuildOptions } from "esbuild";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { packageSafeLibraries } from "./package-safe.mjs";

function optionalLeftovers() {
  const data: Record<string, string> = {
    "/repo/package.json": JSON.stringify({ license: "MIT", exports: {
      "./safe-js": { types: "./packages/safe-js/dist/index.d.ts", import: "./packages/safe-js/dist/index.js" },
    } }),
  };
  for (const name of ["safe-fs", "safe-js", "safe-bash"]) {
    data[`/repo/packages/${name}/package.json`] = JSON.stringify({ name: `private-${name}`, exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } });
    data[`/repo/packages/${name}/README.md`] = `# ${name}`;
    for (const entry of ["index", "core"]) for (const suffix of ["js", "d.ts"])
      data[`/repo/packages/${name}/dist/${entry}.${suffix}`] = "export {};\n";
  }
  const fs = JSON.parse(data["/repo/packages/safe-fs/package.json"]!);
  fs.exports["./core"] = { types: "./dist/core.d.ts", import: "./dist/core.js" };
  data["/repo/packages/safe-fs/package.json"] = JSON.stringify(fs);
  const volume = Volume.fromJSON(data);
  const bundle = vi.fn(async (_settings: BuildOptions) => ({ outputFiles: [] as { path: string; contents: Uint8Array }[] }));
  return { volume, options: { rootDir: "/repo", version: "0.1.0", files: createFsFromVolume(volume).promises, bundle } };
}

it("publishes portable SafeJS root and subpaths despite legacy SDK browser prohibitions", async () => {
  const { volume, options } = optionalLeftovers();
  const source = JSON.parse(readFileSync(new URL("../packages/safe-js/package.json", import.meta.url), "utf8"));
  delete source.bin;
  volume.writeFileSync("/repo/packages/safe-js/dist/workerd.d.ts", "export * from \"./core.js\";\nexport interface WorkerBinding { readonly name: string; }\n");
  source.exports = Object.fromEntries(Object.entries(source.exports).filter(([key]) => [".", "./core", "./modules/fs"].includes(key)));
  volume.writeFileSync("/repo/packages/safe-js/package.json", JSON.stringify(source));
  const root = JSON.parse(volume.readFileSync("/repo/package.json", "utf8") as string);
  root.exports["./safe-js"].browser = null;
  root.exports["./safe-js/core"] = { types: "./packages/safe-js/dist/core.d.ts", browser: null, import: "./packages/safe-js/dist/core.js" };
  volume.writeFileSync("/repo/package.json", JSON.stringify(root));
  for (const entry of ["core", "modules/fs"]) {
    volume.mkdirSync(path.dirname(`/repo/packages/safe-js/dist/${entry}.js`), { recursive: true });
    for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-js/dist/${entry}.${suffix}`, "export {};\n");
  }
  options.bundle.mockImplementation(async settings => ({ outputFiles:
    Object.keys((settings as BuildOptions).entryPoints ?? {}).filter(name => name.startsWith("portable/")).map(name => ({
      path: `/repo/packages/safe-js/dist/${name}.js`, contents: Buffer.from("export const portable = true;\n"),
    })) }));
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const published = JSON.parse(volume.readFileSync("/output/safe-js/package.json", "utf8") as string);
  for (const [route, entry] of [[".", "core"], ["./core", "core"], ["./modules/fs", "modules/fs"]]) {
    const target = published.exports[route];
    for (const condition of ["workerd", "browser"]) {
      expect(target[condition]).toBe(`./dist/safe-js/portable/${entry}.js`);
      const declaration = route === "." && condition === "workerd" ? "workerd" : entry;
      expect(target.types[condition]).toBe(`./dist/safe-js/${declaration}.d.ts`);
      if (declaration === "workerd") expect(volume.readFileSync(`/output/safe-js/${target.types[condition].slice(2)}`, "utf8")).toContain("interface WorkerBinding");
      expect(volume.readFileSync(`/output/safe-js/${target[condition].slice(2)}`, "utf8")).toContain("portable = true");
      expect(Object.keys(target).indexOf(condition)).toBeLessThan(Object.keys(target).indexOf("import"));
    }
  }
  const recipe = options.bundle.mock.calls.map(([settings]) => settings as BuildOptions)
    .find(settings => Object.hasOwn(settings.entryPoints ?? {}, "portable/core"))!;
  expect(recipe.platform).toBe("browser");
  expect(recipe.conditions).toEqual(["workerd"]);
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const artifact = await build({ ...recipe,
    absWorkingDir: repository,
    entryPoints: Object.fromEntries(Object.entries(recipe.entryPoints as Record<string, string>).map(([name, file]) => [name, file.replace("/repo/", repository)])),
    alias: { "@poe-code/safe-fs": "@poe-platform/safe-fs" },
  });
  for (const output of artifact.outputFiles!) {
    const destination = output.path.replace("/repo/packages/safe-js/dist/", "/output/safe-js/dist/safe-js/");
    volume.mkdirSync(path.dirname(destination), { recursive: true });
    volume.writeFileSync(destination, output.contents);
  }
  const filesystem = await build({ entryPoints: [path.join(repository, "packages/safe-fs/src/core.ts")],
    bundle: true, write: false, platform: "browser", format: "esm" });
  volume.writeFileSync("/output/safe-fs/dist/safe-fs/core.js", filesystem.outputFiles[0]!.contents);
  for (const condition of ["browser", "workerd"]) {
    const installed = await build({ stdin: { contents: `
      import { run, makeFsModule, makeEnvModule, makeTimeModule, makeFailModule, makeMetricModule, makeHarnessModule } from '@poe-platform/safe-js';
      import { run as coreRun } from '@poe-platform/safe-js/core';
      import { makeFsModule as subpathFs } from '@poe-platform/safe-js/modules/fs';
      import { S3FileSystem, MockS3Client, createS3Transport } from '@poe-platform/safe-fs';
      export async function verify() {
        if (makeEnvModule({ allow: ['ABSENT'] }).get('ABSENT') !== undefined) throw new Error('Unexpected ambient environment');
        if (run !== coreRun || makeFsModule !== subpathFs) throw new Error('Divergent portable API identities');
        for (const factory of [makeEnvModule, makeTimeModule, makeFailModule, makeMetricModule, makeHarnessModule])
          if (typeof factory !== 'function') throw new Error('Missing portable module builder');
        const fs = new S3FileSystem({ bucket: 'test', transport: createS3Transport(new MockS3Client({ buckets: ['test'] })) });
        await fs.writeFile('/value', new TextEncoder().encode('portable'));
        const result = await run('import {readFile} from "fs"; return await readFile("/value", "utf8");', {
          modules: { fs: makeFsModule({ adapter: fs }) }
        });
        if (result.returnValue !== 'portable') throw new Error('Installed S3/SafeJS round trip failed');
      }` }, bundle: true, write: false, platform: "browser", format: "cjs",
      plugins: [{ name: "installed-packages", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.pluginData?.externalDependency || args.namespace === "file") return undefined;
          if (!args.path.startsWith(".") && !args.path.startsWith("@poe-platform/"))
            return builder.resolve(args.path, { resolveDir: repository, kind: args.kind, pluginData: { externalDependency: true } });
          if (args.path.startsWith(".")) return { path: path.posix.resolve(args.resolveDir, args.path), namespace: "installed" };
          const name = args.path.split("/")[1];
          const directory = `/output/${name}`;
          const pkg = JSON.parse(volume.readFileSync(`${directory}/package.json`, "utf8") as string);
          const subpath = args.path.split("/").slice(2).join("/");
          const target = pkg.exports[subpath ? `./${subpath}` : "."];
          return { path: path.posix.resolve(directory, target[condition] ?? target.import), namespace: "installed" };
        });
        builder.onLoad({ filter: /.*/, namespace: "installed" }, args => ({ contents: volume.readFileSync(args.path, "utf8") as string, resolveDir: path.posix.dirname(args.path), loader: "js" }));
      } }],
    });
    const module = { exports: {} as { verify(): Promise<void> } };
    runInContext(installed.outputFiles[0]!.text, createContext({ module, exports: module.exports,
      TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView, ArrayBuffer, SharedArrayBuffer, crypto, structuredClone, setTimeout, clearTimeout, DOMException, AbortController, AbortSignal, URL }));
    await module.exports.verify();
  }
});

it("portable Node command artifact initializes without native provider imports or Node globals", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const recipe = resolveBrowserShellBuild(root);
  const artifact = await build({ ...recipe,
    entryPoints: { "commands/node/index.browser": recipe.entryPoints["commands/node/index.browser"] },
    alias: { ...recipe.alias, "@poe-code/safe-fs/runtime-core": path.join(root, "packages/safe-fs/src/runtime-core.ts"), "@poe-code/xml-ast": path.join(root, "packages/xml-ast/src/index.ts"), "@poe-code/safe-fs": path.join(root, "packages/safe-fs/src"), "poe-code/safe-fs": path.join(root, "packages/safe-fs/src") },
    external: [], splitting: false, format: "cjs", sourcemap: false,
  });
  expect(Object.values(artifact.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const inputs = Object.keys(artifact.metafile!.inputs);
  for (const native of ["host.ts", "values.ts", "worker-provider.ts"]) {
    expect(inputs.some(name => name.endsWith(`/commands/node/${native}`))).toBe(false);
  }
  const module = { exports: {} as { createNodeCommand(): { name: string } } };
  runInContext(artifact.outputFiles[0]!.text, createContext({ module, exports: module.exports,
    TextEncoder, TextDecoder, URL, AbortController, AbortSignal, setTimeout, clearTimeout }));
  expect(module.exports.createNodeCommand().name).toBe("node");
});
