import * as fs from "node:fs/promises";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import semver from "semver";
import glob from "fast-glob";
import ts from "typescript";
import { build } from "esbuild";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { resolveBundleGraph } from "./bundle-graph.mjs";
import { copyNativeAssets, nativeImportMapping, readBuiltNativeAssets } from "../packages/safe-fs/scripts/native-assets.mjs";
import { resolveWorkerdRuntimeBuild } from "./bundle-fs.mjs";

/**
 * @param {string} filename
 * @param {string} text
 * @param {(specifier: string) => string} rewrite
 */
export function rewriteModuleSpecifiers(filename, text, rewrite) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const replacements = [];
  const visit = node => {
    let literal;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) literal = node.arguments[0];
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const base = node.arguments?.[1];
      if (base && ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression) && base.expression.keywordToken === ts.SyntaxKind.ImportKeyword) literal = node.arguments?.[0];
    }
    if (literal && ts.isStringLiteral(literal)) {
      const value = rewrite(literal.text);
      if (value !== literal.text) replacements.push({ start: literal.getStart(source), end: literal.end, value: JSON.stringify(value) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
  }
  return text;
}

function artifactPath(rootDir, filename) {
  const parts = path.relative(rootDir, filename).split(path.sep);
  if (parts[0] !== "packages" || parts[2] !== "dist" || parts.includes("..")) throw new Error(`Not a built package file: ${filename}`);
  return path.posix.join("dist", parts[1], ...parts.slice(3));
}

function publicSpecifier(specifier) {
  for (const [from, to] of [["poe-code/safe-fs", "@poe-platform/safe-fs"], ["@poe-code/safe-fs", "@poe-platform/safe-fs"], ["@poe-platform/safe-js/fs", "@poe-platform/safe-fs"], ["poe-code/safe-js", "@poe-platform/safe-js"], ["poe-code/safejs", "@poe-platform/safe-js"]]) {
    if (specifier === from || specifier.startsWith(from + "/")) return to + specifier.slice(from.length);
  }
  return specifier;
}

async function prepareOptionalPackage({ rootDir, files, workspaces, excluded }) {
  const name = "safe-bash";
  const packageDir = path.join(rootDir, "packages", name);
  const dist = path.join(packageDir, "dist/opt-in");
  const source = workspaces.find(workspace => workspace.dir === name)?.pkg;
  const exports = Object.fromEntries(Object.entries(source.exports).filter(([, value]) => value?.import?.startsWith("./dist/opt-in/")));
  const peers = new Map(["safe-bash", "safe-fs"].map(peer => ["@poe-platform/" + peer, workspaces.find(workspace => workspace.dir === peer)]));
  const core = peers.get("@poe-platform/safe-bash");
  if (core?.pkg.peerDependencies?.yaml !== "2.9.0" || core.pkg.peerDependenciesMeta?.yaml?.optional !== true) {
    throw new Error("Optional package requires the qualified optional yaml 2.9.0 peer");
  }
  const read = async filename => {
    if (!filename.startsWith(packageDir + path.sep)) throw new Error(`Optional file escapes workspace: ${filename}`);
    let current = packageDir;
    const segments = ["", ...path.relative(packageDir, filename).split(path.sep)];
    for (const segment of segments) {
      current = path.join(current, segment);
      let stat;
      try { stat = await files.lstat(current); }
      catch (error) {
        if (error.code === "ENOENT") throw new Error(`Missing optional package prerequisite: ${path.relative(packageDir, filename)}`, { cause: error });
        throw error;
      }
      if (stat.isSymbolicLink() || (current === filename ? !stat.isFile() : !stat.isDirectory())) throw new Error(`Expected regular optional input: ${filename}`);
    }
    return files.readFile(filename);
  };
  const peerTarget = async (specifier, declaration) => {
    const peerName = specifier.split("/").slice(0, 2).join("/");
    const peer = peers.get(peerName);
    if (!peer) throw new Error(`Unmapped optional peer: ${specifier}`);
    const key = "." + specifier.slice(peerName.length);
    const routes = Object.entries(peer.pkg.exports ?? {}).sort(([left], [right]) => Number(left.includes("*")) - Number(right.includes("*")) || right.split("*")[0].length - left.split("*")[0].length || right.length - left.length);
    for (const [route, value] of routes) {
      const parts = route.split("*");
      const match = route === key ? "" : parts.length === 2 && key.startsWith(parts[0]) && key.endsWith(parts[1]) ? key.slice(parts[0].length, key.length - parts[1].length) : undefined;
      if (match === undefined) continue;
      let target = value;
      while (target && typeof target === "object" && !Array.isArray(target)) target = declaration && target.types !== undefined ? target.types : target.import ?? target.default;
      if (typeof target !== "string" || !target.startsWith("./dist/")) break;
      for (const value of [match, target.slice(2)]) {
        for (const segment of value.replaceAll("\\", "/").split("/")) {
          let decoded = segment.toLowerCase();
          for (const character of ".node_modules") {
            for (const spelling of [character, character.toUpperCase()]) decoded = decoded.replaceAll("%" + spelling.charCodeAt(0).toString(16), character);
          }
          if ([".", "..", "node_modules"].includes(decoded)) throw new Error(`Invalid optional peer subpath: ${specifier}`);
        }
      }
      const template = new URL(target, pathToFileURL(path.join(rootDir, "packages", peer.dir, "package.json")));
      const completed = new URL(template.href.replaceAll("*", () => match));
      if (["%2f", "%5c"].some(encoded => completed.pathname.toLowerCase().includes(encoded))) throw new Error(`Invalid optional peer subpath: ${specifier}`);
      fileURLToPath(completed);
      target = target.replaceAll("*", match);
      if (declaration && target.endsWith(".js")) target = target.slice(0, -3) + ".d.ts";
      const filename = path.resolve(rootDir, "packages", peer.dir, target);
      if (!filename.startsWith(path.join(rootDir, "packages", peer.dir, "dist") + path.sep) || excluded(filename)) break;
      const stat = await files.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) break;
      return;
    }
    throw new Error(`Unexported optional peer route: ${specifier}`);
  };
  const contents = new Map();
  const inspected = new Set();
  const entrypoints = new Set(Object.values(exports).flatMap(value => [value.import, value.types]).map(target => path.resolve(packageDir, target)));
  const pending = ["optional.js", "optional.d.ts", ...Object.values(exports).flatMap(value => [value.import, value.types].map(target => path.relative(dist, path.resolve(packageDir, target))))].map(relative => ({ filename: path.join(dist, relative), asset: false }));
  while (pending.length) {
    const { filename, asset } = pending.pop();
    if (!filename.startsWith(dist + path.sep)) throw new Error(`Optional module escapes owned output: ${filename}`);
    if (!entrypoints.has(filename) && !excluded(path.join(rootDir, "packages/safe-bash/dist", path.relative(dist, filename)))) throw new Error(`Not an optional-owned artifact: ${filename}`);
    const bytes = contents.get(filename) ?? await read(filename);
    contents.set(filename, bytes);
    if (![".js", ".mjs", ".cjs", ".d.ts", ".d.mts", ".d.cts"].some(extension => filename.endsWith(extension))) {
      if (asset || filename.endsWith(".json")) continue;
      throw new Error(`Unsupported optional module: ${filename}`);
    }
    if (inspected.has(filename)) continue;
    inspected.add(filename);
    const declaration = [".d.ts", ".d.mts", ".d.cts"].some(extension => filename.endsWith(extension));
    const parsed = ts.createSourceFile(filename, bytes.toString(), ts.ScriptTarget.Latest, true);
    if (parsed.parseDiagnostics.length || parsed.referencedFiles.length || parsed.typeReferenceDirectives.length) throw new Error(`Unsupported optional module syntax: ${filename}`);
    const edges = [];
    const visit = node => {
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) throw new Error(`Unsupported optional external import-equals: ${filename}`);
      let literal, asset = false, edge = false;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { literal = node.moduleSpecifier; edge = literal !== undefined; }
      else if (ts.isImportTypeNode(node)) { literal = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined; edge = true; }
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) { literal = node.arguments[0]; edge = true; }
      else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
        const base = node.arguments?.[1];
        if (base && ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression) && base.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
          literal = node.arguments?.[0]; edge = true; asset = true;
        }
      }
      if (edge) {
        if (!literal || !ts.isStringLiteral(literal)) throw new Error(`Nonliteral optional module reference: ${filename}`);
        edges.push({ specifier: literal.text, asset });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const { specifier, asset } of edges) {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        let target = path.resolve(path.dirname(filename), specifier);
        if (declaration && !asset) {
          for (const [runtime, types] of [[".js", ".d.ts"], [".mjs", ".d.mts"], [".cjs", ".d.cts"]]) if (target.endsWith(runtime)) { target = target.slice(0, -runtime.length) + types; break; }
        }
        pending.push({ filename: target, asset });
      } else if (asset) throw new Error(`Unmapped optional asset: ${specifier}`);
      else if (builtinModules.includes(specifier) || specifier.startsWith("node:") && builtinModules.includes(specifier.slice(5))) continue;
      else if (specifier === "yaml") continue;
      else await peerTarget(specifier, declaration);
    }
  }
  return {
    exports, contents: new Map([...contents].map(([filename, bytes]) => [path.relative(dist, filename), bytes])),
  };
}

/**
 * @param {{
 * rootDir: string, outDir: string, version: string,
 * files?: {
 *   readFile(path: string, encoding?: "utf8"): Promise<string | Buffer>,
 *   stat(path: string): Promise<{ isFile(): boolean }>,
 *   lstat(path: string): Promise<{ isFile(): boolean, isDirectory(): boolean, isSymbolicLink(): boolean }>,
 *   readdir(path: string, options: { withFileTypes: true }): Promise<(string | Buffer | { name: string | Buffer, isDirectory(): boolean })[]>,
 *   mkdir(path: string, options?: { recursive: boolean }): Promise<unknown>,
 *   writeFile(path: string, data: string | Uint8Array): Promise<void>,
 *   copyFile(source: string, destination: string): Promise<void>,
 *   chmod(path: string, mode: number): Promise<void>
 * },
 * bundle?: (options: import("esbuild").BuildOptions & { write: false }) => Promise<{ outputFiles: { path: string, contents: Uint8Array }[] }>
 * }} options
 */
export async function packageSafeLibraries({ rootDir, outDir, version, files = fs, bundle = build }) {
  if (!semver.valid(version)) throw new Error("A valid explicit package version is required");
  if (path.resolve(outDir) === path.resolve(rootDir) || path.resolve(outDir).startsWith(path.join(rootDir, "packages") + path.sep)) throw new Error("Output must not overwrite workspace packages");
  const readJson = async filename => JSON.parse(await files.readFile(filename, "utf8"));
  const exists = async filename => {
    try { return (await files.stat(filename)).isFile(); }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  };
  const root = await readJson(path.join(rootDir, "package.json"));
  const ranges = { ...root.devDependencies, ...root.optionalDependencies, ...root.dependencies };
  const privateNames = new Set();
  const workspaces = [];
  for (const entry of await files.readdir(path.join(rootDir, "packages"), { withFileTypes: true })) {
    const manifest = path.join(rootDir, "packages", entry.name, "package.json");
    if (!entry.isDirectory() || !await exists(manifest)) continue;
    const pkg = await readJson(manifest);
    workspaces.push({ dir: entry.name, pkg });
    if (pkg.private) privateNames.add(pkg.name);
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) ranges[name] ??= range;
  }
  const exclusionPolicies = new Map();
  const excluded = filename => {
    const absolute = path.resolve(filename);
    const ownerName = path.relative(path.resolve(rootDir, "packages"), absolute).split(path.sep)[0];
    const owner = workspaces.find(workspace => workspace.dir === ownerName);
    if (!owner) return false;
    let excludedPaths = exclusionPolicies.get(ownerName);
    if (!excludedPaths) {
      const packageDir = path.resolve(rootDir, "packages", ownerName);
      excludedPaths = (owner.pkg.files ?? []).filter(entry => entry.startsWith("!")).map(entry => {
        const relative = entry.slice(1);
        const target = path.resolve(packageDir, relative);
        if (!relative || path.isAbsolute(relative) || glob.isDynamicPattern(relative) || !target.startsWith(packageDir + path.sep)) {
          throw new Error(`Unsupported package file exclusion: ${entry}`);
        }
        return target;
      });
      exclusionPolicies.set(ownerName, excludedPaths);
    }
    return excludedPaths.some(omitted => absolute === omitted || absolute.startsWith(omitted + path.sep));
  };
  const results = [];
  const fsManifest = workspaces.find(workspace => workspace.dir === "safe-fs").pkg;
  const optional = Object.values(workspaces.find(workspace => workspace.dir === "safe-bash").pkg.exports).some(value => value?.import?.startsWith("./dist/opt-in/"))
    ? await prepareOptionalPackage({ rootDir, files, workspaces, excluded }) : undefined;
  const nativeAssets = await exists(path.join(rootDir, "packages/safe-fs/native/assets.json"))
    ? await readBuiltNativeAssets({ rootDir, files }) : undefined;
  for (const name of ["safe-fs", "safe-js", "safe-bash"]) {
    const packageDir = path.join(rootDir, "packages", name);
    const source = await readJson(path.join(packageDir, "package.json"));
    const directory = path.join(outDir, name);
    await files.mkdir(outDir, { recursive: true });
    await files.mkdir(directory);
    const pending = [];
    const copied = new Set();
    if (name === "safe-fs" && nativeAssets) {
      await copyNativeAssets({ rootDir, files,
        outDir: path.join(directory, artifactPath(rootDir, path.join(rootDir, "packages/safe-fs/dist"))) });
      for (const entry of nativeAssets.entries) copied.add(path.join(nativeAssets.directory, entry.name));
    }
    const dependencies = {};
    const bundled = new Map();
    if (name === "safe-js") {
      const graph = await resolveBundleGraph(rootDir, workspaces, files);
      const alias = Object.fromEntries(Object.entries(graph.alias).map(([specifier, target]) => [specifier, publicSpecifier(specifier) !== specifier ? publicSpecifier(specifier) : target]));
      const entryPoints = Object.fromEntries(Object.entries(source.exports).filter(([key]) => key !== "./workerd").map(([key, target]) => [key === "." ? "index" : key.slice(2), path.join(packageDir, "src", target.import.slice("./dist/".length, -3) + ".ts")]));
      const external = [...graph.external, "@poe-platform/safe-fs"];
      const result = await bundle({ absWorkingDir: rootDir, entryPoints, alias, external, bundle: true, splitting: true, platform: "node", target: "node18.18", format: "esm", outdir: path.join(packageDir, "dist"), chunkNames: "chunks/[name]-[hash]", sourcemap: true, write: false });
      for (const output of result.outputFiles) bundled.set(output.path, output.contents);
      if (source.exports["./workerd"]) {
        const workerd = await bundle(resolveWorkerdRuntimeBuild(rootDir, { alias, external }));
        for (const output of workerd.outputFiles) bundled.set(output.path, output.contents);
      }
    }
    if (name === "safe-bash") {
      // These runtimes belong to the scoped artifact. Root CLI builds deliberately
      // do not prepare or publish sandbox payloads.
      const graph = await resolveBundleGraph(rootDir, workspaces, files);
      const alias = Object.fromEntries(Object.entries(graph.alias).map(([specifier, target]) => [specifier, publicSpecifier(specifier) !== specifier ? publicSpecifier(specifier) : target]));
      const external = [...graph.external, "@poe-platform/safe-fs"];
      const recipes = [];
      if (Object.values(source.exports).some(value => value?.browser?.endsWith(".browser.js") || value?.workerd?.endsWith(".browser.js"))) {
        const browser = resolveBrowserShellBuild(rootDir);
        recipes.push({ ...browser,
          alias: { ...browser.alias, "@poe-code/safe-fs": "@poe-platform/safe-fs", "poe-code/safe-fs": "@poe-platform/safe-fs" },
          external: [...browser.external, "@poe-platform/safe-fs"],
        });
      }
      for (const command of ["op", "pandoc"]) {
        if (!source.exports["./commands/" + command]) continue;
        const converterDependencies = new Set(workspaces.filter(({ dir }) => dir === "pandoc" || dir === "pdf")
          .flatMap(({ pkg }) => Object.keys(pkg.dependencies ?? {}))
          .filter(dependency => !Object.hasOwn(root.dependencies ?? {}, dependency) && !Object.hasOwn(root.optionalDependencies ?? {}, dependency)));
        recipes.push({ absWorkingDir: rootDir, alias,
          external: command === "pandoc" ? external.filter(dependency => !converterDependencies.has(dependency)) : external,
          entryPoints: [path.join(packageDir, "src/commands", command, "index.ts")],
          outfile: path.join(packageDir, "dist/commands", command, "index.js"),
          bundle: true, platform: "node", target: command === "pandoc" ? "node22" : "es2022", format: "esm", sourcemap: true, write: false,
          ...(command === "pandoc" ? { banner: { js: 'import {createRequire as createPandocRequire} from "node:module"; const require = createPandocRequire(import.meta.url);' } } : {}),
        });
      }
      for (const recipe of recipes) {
        const result = await bundle(recipe);
        for (const output of result.outputFiles) {
          bundled.set(output.path, output.contents);
          pending.push(output.path);
        }
      }
    }
    const enqueueExport = value => {
      if (typeof value === "string" && value.startsWith("./")) {
        const absolute = path.resolve(rootDir, value);
        if (!value.includes("*")) pending.push(absolute);
        return "./" + artifactPath(rootDir, absolute);
      }
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, enqueueExport(item)]));
      return value;
    };
    const exports = {};
    const imports = {};
    const workspaceTarget = value => typeof value === "string" ? value.replace("./dist/", `./packages/${name}/dist/`) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, workspaceTarget(item)])) : value;
    const importTarget = (value, types = false) => {
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
        .map(([condition, target]) => [condition, importTarget(target, types || condition === "types")]));
      if (typeof value !== "string") return value;
      if (!value.startsWith("./")) throw new Error(`Unsupported package import target: ${value}`);
      const built = types && value.startsWith("./src/") && value.endsWith(".ts")
        ? "./dist/" + value.slice(6, -3) + ".d.ts" : value;
      return enqueueExport(workspaceTarget(built));
    };
    if (name === "safe-js") {
      const rootExports = Object.entries(root.exports ?? {})
        .filter(([key]) => key === "./safe-js" || key.startsWith("./safe-js/"))
        .map(([key, value]) => [key === "./safe-js" ? "." : "." + key.slice("./safe-js".length), value]);
      for (const [key, value] of rootExports.length ? rootExports : Object.entries(source.exports).map(([key, value]) => [key, workspaceTarget(value)])) {
        exports[key] = enqueueExport(value);
      }
      for (const suffix of ["", "/core", "/node"]) {
        const target = "./dist/compat/fs" + suffix.replace("/", "-");
        const contents = `export * from ${JSON.stringify("@poe-platform/safe-fs" + suffix)};\n`;
        await files.mkdir(path.join(directory, "dist/compat"), { recursive: true });
        for (const extension of [".js", ".d.ts"]) await files.writeFile(path.join(directory, target + extension), contents);
        exports["./fs" + suffix] = { types: target + ".d.ts", ...(suffix === "/node" ? { browser: null } : {}), import: target + ".js" };
      }
      dependencies["@poe-platform/safe-fs"] = version;
    } else {
      for (const [key, value] of Object.entries(source.exports)) {
        if (name === "safe-bash" && optional?.exports[key]) {
          exports[key] = Object.fromEntries(Object.entries(value).map(([condition, target]) => [condition, target.replace("./dist/", "./dist/safe-bash/")]));
          continue;
        }
        let target = value;
        if (name === "safe-fs") {
          if (key === "." || key === "./contracts") target = { types: { browser: "./dist/core.d.ts", default: value.types }, browser: "./dist/core.js", import: value.import };
          if (["./node", "./fs/real", "./fs/s3", "./fs/s3/http"].includes(key)) target = { types: { browser: "./dist/node-unavailable.d.ts", default: key === "./node" ? "./dist/node-host.d.ts" : value.types }, browser: null, import: key === "./node" ? "./dist/node-host.js" : value.import };
        }
        exports[key] = enqueueExport(workspaceTarget(target));
      }
      const walk = async directory => {
        for (const entry of await files.readdir(directory, { withFileTypes: true })) {
          const filename = path.join(directory, entry.name);
          if (excluded(filename)) continue;
          if (entry.isDirectory()) await walk(filename);
          else if (!entry.name.endsWith(".map") && !(name === "safe-fs" && entry.name === "package.json")) pending.push(filename);
        }
      };
      await walk(path.join(packageDir, "dist"));
    }
    const addDependency = specifier => {
      const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (dependency === `@poe-platform/${name}`) return;
      if (dependency === "@poe-platform/safe-js" || dependency === "@poe-platform/safe-fs") { dependencies[dependency] = version; return; }
      if (dependency === "poe-code" || privateNames.has(dependency)) throw new Error(`Private or CLI dependency leaked: ${specifier}`);
      const range = ranges[dependency];
      if (!range || range === "*" || range.startsWith("workspace:")) throw new Error(`Missing publishable dependency range: ${specifier}`);
      dependencies[dependency] = range;
    };
    while (pending.length) {
      const filename = pending.pop();
      if (excluded(filename)) throw new Error(`Excluded package file referenced: ${path.relative(packageDir, filename)}`);
      if (copied.has(filename)) continue;
      copied.add(filename);
      if (!excluded(filename + ".map") && (bundled.has(filename + ".map") || await exists(filename + ".map"))) pending.push(filename + ".map");
      const destination = path.join(directory, artifactPath(rootDir, filename));
      let contents = bundled.has(filename) ? Buffer.from(bundled.get(filename)) : await files.readFile(filename);
      if (filename.endsWith(".js") || filename.endsWith(".mjs") || filename.endsWith(".ts")) {
        const declaration = filename.endsWith(".d.ts") || filename.endsWith(".d.mts");
        contents = rewriteModuleSpecifiers(filename, contents.toString(), specifier => {
          if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
            if (declaration && ranges["@types/node"]) addDependency("@types/node");
            return specifier;
          }
          if (nativeAssets && specifier === nativeAssets.registry.specifier) {
            if (name !== "safe-fs") throw new Error("Filesystem implementation leaked into " + name);
            return specifier;
          }
          if (specifier === "#safe-fs-platform") {
            if (name !== "safe-fs") throw new Error("Filesystem implementation leaked into " + name);
            for (const profile of ["node", "browser"]) pending.push(path.join(rootDir, "packages/safe-fs/dist/platform", profile + (declaration ? ".d.ts" : ".js")));
            return specifier;
          }
          if (specifier.startsWith("#") && Object.hasOwn(source.imports ?? {}, specifier)) {
            if (!Object.hasOwn(imports, specifier)) imports[specifier] = importTarget(source.imports[specifier]);
            return specifier;
          }
          let publicName = publicSpecifier(specifier);
          if (declaration || name === "safe-bash" && (publicName === "@poe-code/office-package" || publicName.startsWith("@poe-code/office-package/"))) {
            const workspace = workspaces.find(({ pkg }) => pkg.private && (publicName === pkg.name || publicName.startsWith(pkg.name + "/")));
            if (workspace) {
              const route = "." + publicName.slice(workspace.pkg.name.length);
              const exported = workspace.pkg.exports?.[route];
              const entrypoint = declaration
                ? exported?.types ?? (route === "." && workspace.pkg.exports === undefined ? workspace.pkg.types : undefined)
                : exported?.import;
              if (typeof entrypoint !== "string") throw new Error(`Missing private workspace ${declaration ? "declaration" : "runtime"} entrypoint: ${specifier}`);
              const target = path.resolve(rootDir, "packages", workspace.dir, entrypoint);
              artifactPath(rootDir, target);
              if (declaration && !target.endsWith(".d.ts") && !target.endsWith(".d.mts")) throw new Error(`Not a private workspace declaration: ${specifier}`);
              publicName = path.relative(path.dirname(filename), target).split(path.sep).join("/");
              if (!publicName.startsWith(".")) publicName = "./" + publicName;
            }
          }
          if (!publicName.startsWith(".")) {
            if (publicName.startsWith("#")) throw new Error(`Unresolved package import: ${publicName}`);
            addDependency(publicName);
            return publicName;
          }
          let target = path.resolve(path.dirname(filename), publicName);
          if (name !== "safe-fs" && target.startsWith(path.join(rootDir, "packages/safe-fs/dist") + path.sep)) {
            const runtime = target.endsWith(".d.ts") ? target.slice(0, -5) + ".js" : target;
            const route = Object.entries(fsManifest.exports).find(([, value]) => path.resolve(rootDir, "packages/safe-fs", value.import) === runtime);
            if (!route) throw new Error(`Unexported canonical filesystem reference: ${specifier}`);
            addDependency("@poe-platform/safe-fs");
            return "@poe-platform/safe-fs" + (route[0] === "." ? "" : route[0].slice(1));
          }
          if (declaration && target.endsWith(".js")) target = target.slice(0, -3) + ".d.ts";
          pending.push(target);
          let relative = path.relative(path.dirname(destination), path.join(directory, artifactPath(rootDir, target))).split(path.sep).join("/");
          if (declaration && relative.endsWith(".d.ts")) relative = relative.slice(0, -5) + ".js";
          return relative.startsWith(".") ? relative : "./" + relative;
        });
      }
      await files.mkdir(path.dirname(destination), { recursive: true });
      await files.writeFile(destination, contents);
    }
    const manifest = {
      name: `@poe-platform/${name}`, version, description: source.description ?? (name === "safe-fs" ? "Composable filesystem with a portable core and explicit Node adapters" : "Budgeted JavaScript interpreter with explicit host capabilities and resumable execution"),
      type: "module", license: root.license, engines: source.engines ?? { node: ">=18.18" },
      files: ["dist"], exports,
      repository: { type: "git", url: "git+https://github.com/poe-platform/poe-code.git", directory: `packages/${name}` },
      publishConfig: { access: "public" }, dependencies,
    };
    if (Object.keys(imports).length) manifest.imports = imports;
    if (name === "safe-fs") manifest.imports = { "#safe-fs-platform": { types: { browser: "./dist/safe-fs/platform/browser.d.ts", default: "./dist/safe-fs/platform/node.d.ts" }, browser: "./dist/safe-fs/platform/browser.js", default: "./dist/safe-fs/platform/node.js" } };
    if (name === "safe-fs" && nativeAssets) manifest.imports[nativeAssets.registry.specifier] = nativeImportMapping(nativeAssets.registry,
      artifactPath(rootDir, path.join(rootDir, "packages/safe-fs/dist")));
    if (name === "safe-js") {
      if (source.bin) manifest.bin = Object.fromEntries(Object.entries(source.bin).map(([command, target]) => [command, "./" + artifactPath(rootDir, path.resolve(packageDir, target))]));
    }
    if (name === "safe-bash" && optional) {
      manifest.peerDependencies = { yaml: source.peerDependencies.yaml };
      manifest.peerDependenciesMeta = { yaml: { optional: true } };
      for (const [filename, bytes] of optional.contents) {
        const target = path.join(directory, "dist/safe-bash/opt-in", filename);
        await files.mkdir(path.dirname(target), { recursive: true });
        await files.writeFile(target, bytes);
      }
    }
    await files.mkdir(directory, { recursive: true });
    await files.writeFile(path.join(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    await files.copyFile(path.join(packageDir, "README.md"), path.join(directory, "README.md"));
    if (await exists(path.join(rootDir, "LICENSE"))) await files.copyFile(path.join(rootDir, "LICENSE"), path.join(directory, "LICENSE"));
    for (const target of Object.values(manifest.bin ?? {})) await files.chmod(path.join(directory, target), 0o755);
    results.push({ name: manifest.name, directory, version, files: copied.size });
  }
  return results;
}

export function parsePackageSafeArguments(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { "out-dir": { type: "string" }, version: { type: "string" } } });
  if (!values["out-dir"] || !values.version) throw new Error("Usage: node scripts/package-safe.mjs --out-dir <directory> --version <version>");
  return { outDir: path.resolve(values["out-dir"]), version: values.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await packageSafeLibraries({ rootDir: fileURLToPath(new URL("../", import.meta.url)), ...parsePackageSafeArguments() }), null, 2));
}
