import {readFileSync, readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createContext, runInContext} from "node:vm";
import {createFsFromVolume, Volume} from "memfs";
import {build} from "esbuild";
import ts from "typescript";
import {expect, it} from "vitest";
import {packageSafeLibraries} from "./package-safe.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

it("packs the image PNG filesystem API with canonical public storage and a host-free Worker closure", async () => {
  const volume = new Volume();
  const write = (filename: string, bytes: string | Uint8Array) => {
    volume.mkdirSync(path.dirname(filename), {recursive: true});
    volume.writeFileSync(filename, bytes);
  };
  const copy = (source: string, target: string): void => {
    for (const entry of readdirSync(source, {withFileTypes: true})) {
      if (entry.isDirectory()) copy(path.join(source, entry.name), path.join(target, entry.name));
      else write(path.join(target, entry.name), readFileSync(path.join(source, entry.name)));
    }
  };
  const rootManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  write("/repo/package.json", JSON.stringify({license: "MIT", dependencies: rootManifest.dependencies, devDependencies: rootManifest.devDependencies}));
  // Unrelated shell/interpreter entries are fixtures; every image and filesystem artifact is real.
  for (const name of ["safe-js", "safe-bash"]) {
    write(`/repo/packages/${name}/package.json`, JSON.stringify({name: `@poe-code/${name}`, private: true, type: "module", exports: {".": {types: "./dist/index.d.ts", import: "./dist/index.js"}}}));
    write(`/repo/packages/${name}/README.md`, `# ${name}\n`);
    for (const extension of ["js", "d.ts"]) write(`/repo/packages/${name}/dist/index.${extension}`, "export {};\n");
  }
  for (const name of ["safe-fs", "xml-ast", "image-ast", "pdf-ast"]) {
    const directory = path.join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    if (name === "safe-fs") manifest.exports = Object.fromEntries(["./contracts", "./storage", "./core", "./xml"].map(route => [route, manifest.exports[route]]));
    write(`/repo/packages/${name}/package.json`, JSON.stringify(manifest));
    write(`/repo/packages/${name}/README.md`, readFileSync(path.join(directory, "README.md")));
    copy(path.join(directory, "dist"), `/repo/packages/${name}/dist`);
    if (name === "safe-fs") {
      copy(path.join(directory, "native"), `/repo/packages/${name}/native`);
      copy(path.join(directory, "src/native"), `/repo/packages/${name}/src/native`);
    }
    for (const notice of manifest.poeCode?.safeLibraryNotices?.["safe-bash"] ?? []) write(`/repo/packages/${name}/${notice}`, readFileSync(path.join(directory, notice)));
  }
  await packageSafeLibraries({rootDir: "/repo", outDir: "/output", version: "0.1.0", files: createFsFromVolume(volume).promises, bundle: async () => ({outputFiles: []})});
  const manifests = Object.fromEntries(["safe-fs", "safe-bash"].map(name => [name, JSON.parse(volume.readFileSync(`/output/${name}/package.json`, "utf8").toString())]));
  expect(manifests["safe-bash"].exports["./sharp"]).toEqual(manifests["safe-bash"].exports["./image-ast"]);
  const runtime = volume.readFileSync("/output/safe-bash/dist/image-ast/index.js", "utf8").toString();
  expect(runtime).toContain('"@poe-platform/safe-fs/storage"');
  expect(runtime).toContain('"@poe-platform/safe-fs/contracts"');
  const ast = volume.readFileSync("/output/safe-bash/dist/image-ast/ast.d.ts", "utf8").toString();
  expect(ast).toContain('"@poe-platform/safe-fs/contracts"');
  for (const manifest of Object.values(manifests)) expect(Object.keys(manifest.dependencies)).not.toContain("@poe-code/safe-fs");
  volume.mkdirSync("/node_modules/@poe-platform", {recursive: true});
  for (const name of ["safe-fs", "safe-bash"]) volume.symlinkSync(`/output/${name}`, `/node_modules/@poe-platform/${name}`);
  write("/consumer.mts", 'import sharp from "@poe-platform/safe-bash/sharp"; import type {FileSystem} from "@poe-platform/safe-fs/contracts"; declare const filesystem: FileSystem; sharp("/in.png", {filesystem}).png().toFile("/out.png");');
  const compilerOptions: ts.CompilerOptions = {strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, customConditions: ["workerd"]};
  const host = ts.createCompilerHost(compilerOptions);
  // Only TypeScript standard libraries may escape the published in-memory installation.
  const standardRead = host.readFile;
  const standardExists = host.fileExists;
  const libraries = path.dirname(ts.getDefaultLibFilePath(compilerOptions)) + path.sep;
  host.readFile = filename => filename.startsWith(libraries) ? standardRead(filename) : volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined;
  host.fileExists = filename => filename.startsWith(libraries) ? standardExists(filename) : volume.existsSync(filename);
  host.directoryExists = filename => volume.existsSync(filename) && volume.statSync(filename).isDirectory();
  host.realpath = filename => volume.realpathSync(filename).toString();
  host.getCurrentDirectory = () => "/";
  const program = ts.createProgram(["/consumer.mts"], compilerOptions, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  copy(path.join(root, "node_modules/pako"), "/installed/pako");
  copy(path.join(root, "node_modules/@noble/hashes"), "/installed/@noble/hashes");
  write("/consumer.js", 'export {default as sharp} from "@poe-platform/safe-bash/sharp"; export {MemoryFileSystem} from "@poe-platform/safe-fs/core";');
  const select = (value: unknown): string => {
    if (typeof value === "string") return value;
    for (const condition of ["workerd", "browser", "import", "default"]) {
      const target = (value as Record<string, unknown>)[condition];
      if (target !== undefined) return select(target);
    }
    throw new Error("No portable export: " + JSON.stringify(value));
  };
  const result = await build({entryPoints: ["/consumer.js"], bundle: true, write: false, platform: "browser", format: "cjs", metafile: true,
    plugins: [{name: "published-image-only", setup(builder) {
      builder.onResolve({filter: /.*/}, args => {
        let target: string;
        if (args.path.startsWith(".") || args.path.startsWith("/")) target = path.resolve(args.resolveDir, args.path);
        else if (args.path.startsWith("#safe-fs-")) target = path.resolve("/output/safe-fs", select(manifests["safe-fs"].imports[args.path]));
        else {
          const segments = args.path.split("/");
          const name = segments.splice(0, args.path.startsWith("@") ? 2 : 1).join("/");
          const directory = name.startsWith("@poe-platform/") ? "/output/" + name.split("/")[1] : "/installed/" + name;
          const manifest = JSON.parse(volume.readFileSync(directory + "/package.json", "utf8").toString());
          const route = segments.length ? "./" + segments.join("/") : ".";
          target = path.resolve(directory, select(manifest.exports[route]));
        }
        return {path: target, namespace: "packed"};
      });
      builder.onLoad({filter: /.*/, namespace: "packed"}, args => ({contents: volume.readFileSync(args.path, "utf8").toString(), resolveDir: path.dirname(args.path)}));
    }}]});
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const module = {exports: {} as {sharp: typeof import("../packages/image-ast/src/index.js").default; MemoryFileSystem: typeof import("../packages/safe-fs/src/core.js").MemoryFileSystem}};
  runInContext(result.outputFiles[0]!.text, createContext({module, exports: module.exports, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, AbortSignal, AbortController, structuredClone, ReadableStream, WritableStream, TransformStream, queueMicrotask, setTimeout, clearTimeout, crypto: globalThis.crypto}));
  const {sharp, MemoryFileSystem} = module.exports;
  const fs = new MemoryFileSystem();
  const input = await sharp({create: {width: 7, height: 3, channels: 4, background: "red"}}).png().toBuffer();
  await fs.writeFile("/input.png", input);
  const guarded = new Proxy(fs, {get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => {throw new Error("whole-file fallback forbidden");};
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  expect(await sharp("/input.png", {filesystem: guarded}).png().toFile("/output.png")).toMatchObject({width: 7, height: 3, format: "png"});
  expect(await sharp("/input.png", {filesystem: guarded}).flip().rotate(90).flop().png().toFile("/rotated.png")).toMatchObject({width: 3, height: 7, format: "png"});
  expect([...await sharp(await fs.readFile("/rotated.png")).raw().toBuffer()]).toEqual(Array.from({length: 21}, () => [255, 0, 0, 255]).flat());
  expect(await sharp("/input.png", {filesystem: guarded}).negate({alpha:false}).normalize().png().toFile("/negative.png")).toMatchObject({width: 7, height: 3, format: "png"});
  expect([...await sharp(await fs.readFile("/negative.png")).raw().toBuffer()]).toEqual(Array.from({length: 21}, () => [0, 255, 255, 255]).flat());
  expect([...await sharp(await fs.readFile("/output.png")).raw().toBuffer()]).toEqual(Array.from({length: 21}, () => [255, 0, 0, 255]).flat());
});
