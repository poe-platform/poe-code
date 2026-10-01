import { privateExportStarsPlugin } from "./private-export-stars.mjs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import semver from "semver";
import glob from "fast-glob";
import ts from "typescript";
import { build } from "esbuild";
import { resolveBrowserShellBuild, resolvePrivateCommandBuild, resolvePortableBufferBuild } from "./bundle-safe-bash.mjs";
import { resolveBundleGraph } from "./bundle-graph.mjs";
import { resolveCommandExportBuilds } from "./safe-command-publication.mjs";
import { copyNativeAssets, nativeImportMapping, readBuiltNativeAssets } from "../packages/safe-fs/scripts/native-assets.mjs";
import { resolveWorkerdRuntimeBuild } from "./bundle-fs.mjs";
import { canonicalXml } from "../packages/package-lint/dist/bundle-policy.js";
import { declarationSource } from "./publish-declarations.mjs";

import { rewriteModuleSpecifiers } from "./module-specifiers.mjs";
export { rewriteModuleSpecifiers } from "./module-specifiers.mjs";

function artifactPath(rootDir, filename) {
  const parts = path.relative(rootDir, filename).split(path.sep);
  if (parts[0] !== "packages" || parts[2] !== "dist" || parts.includes("..")) throw new Error(`Not a built package file: ${filename}`);
  return path.posix.join("dist", parts[1], ...parts.slice(3));
}

function publicSpecifier(specifier, owner) {
  if (specifier === canonicalXml.workspace && owner !== "safe-fs") return publicSpecifier(canonicalXml.specifier);
  for (const [from, to] of [["poe-code/safe-bash/contracts", "safe-bash-contracts"], ["poe-code/safe-fs", "@poe-platform/safe-fs"], ["@poe-code/safe-fs", "@poe-platform/safe-fs"], ["@poe-platform/safe-js/fs", "@poe-platform/safe-fs"], ["poe-code/safe-js", "@poe-platform/safe-js"], ["poe-code/safejs", "@poe-platform/safe-js"], ["poe-code/ssconvert", "safe-bash-command-ssconvert"]]) {
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
      while (target && typeof target === "object" && !Array.isArray(target)) target = declaration && target.types !== undefined ? target.types : target.import !== undefined ? target.import : target.default;
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
      return filename;
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
          if (!target.startsWith(dist + path.sep)) {
            for (const [peerName, peer] of peers) {
              let route;
              for (const [key, value] of Object.entries(peer.pkg.exports ?? {})) {
                let types = value;
                while (types && typeof types === "object" && !Array.isArray(types)) types = types.types !== undefined ? types.types : types.import !== undefined ? types.import : types.default;
                if (typeof types !== "string") continue;
                const pattern = path.resolve(rootDir, "packages", peer.dir, types).split("*");
                if (pattern.length === 1 && pattern[0] === target) route = key;
                else if (pattern.length === 2 && key.split("*").length === 2 && target.startsWith(pattern[0]) && target.endsWith(pattern[1])) {
                  route = key.replace("*", target.slice(pattern[0].length, target.length - pattern[1].length));
                }
                if (route) break;
              }
              if (!route) continue;
              const publicRoute = peerName + (route === "." ? "" : route.slice(1));
              if (await peerTarget(publicRoute, true) !== target) throw new Error(`Optional declaration route changes target: ${publicRoute}`);
              contents.set(filename, Buffer.from(rewriteModuleSpecifiers(filename, contents.get(filename).toString(), value => value === specifier ? publicRoute : value)));
              target = undefined;
              break;
            }
            if (target === undefined) continue;
          }
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
  const rootSharedRuntimeEntries = new Map();
  for (const { dir, pkg } of workspaces) {
    if (pkg.poeCode?.bundle?.sharedRuntime !== true) continue;
    for (const [route, target] of Object.entries(pkg.exports ?? {})) {
      if (typeof target?.import !== "string" || !target.import.startsWith("./dist/")) continue;
      rootSharedRuntimeEntries.set(path.resolve(rootDir, "dist/shared", dir, target.import.slice("./dist/".length)),
        pkg.name + (route === "." ? "" : route.slice(1)));
    }
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
  const canonicalFileSystemSpecifier = target => {
    target = declarationSource(rootDir, target);
    const xmlTypes = declarationSource(rootDir, path.join(rootDir, canonicalXml.types));
    if ([xmlTypes, xmlTypes.slice(0, -5) + ".js"].includes(target)) {
      return publicSpecifier(canonicalXml.specifier);
    }
    if (!target.startsWith(path.join(rootDir, "packages/safe-fs/dist") + path.sep)) return undefined;
    const runtime = target.endsWith(".d.ts") ? target.slice(0, -5) + ".js" : target;
    const route = Object.entries(fsManifest.exports).find(([, value]) =>
      typeof value.import === "string" && path.resolve(rootDir, "packages/safe-fs", value.import) === runtime);
    if (!route) throw new Error("Unexported canonical filesystem reference: " + target);
    return "@poe-platform/safe-fs" + (route[0] === "." ? "" : route[0].slice(1));
  };
  const canonicalFileSystemImports = {
    name: "canonical-filesystem-imports",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (!args.path.startsWith(".") && !path.isAbsolute(args.path)) return undefined;
        const specifier = canonicalFileSystemSpecifier(path.resolve(args.resolveDir, args.path));
        return specifier ? { path: specifier, external: true } : undefined;
      });
    },
  };
  const optional = Object.values(workspaces.find(workspace => workspace.dir === "safe-bash").pkg.exports).some(value => value?.import?.startsWith("./dist/opt-in/"))
    ? await prepareOptionalPackage({ rootDir, files, workspaces, excluded }) : undefined;
  const nativeAssets = await exists(path.join(rootDir, "packages/safe-fs/native/assets.json"))
    ? await readBuiltNativeAssets({ rootDir, files }) : undefined;
  for (const name of ["safe-fs", "safe-js", "safe-bash"]) {
    const packageDir = path.join(rootDir, "packages", name);
    const source = await readJson(path.join(packageDir, "package.json"));
    const assertPrivateProfile = (workspace, workspaceName) => {
      const profile = source.poeCode?.integration?.privateWorkspaces?.[workspaceName];
      const pkg = workspace?.pkg;
      const directory = workspaceName.startsWith("@") ? workspaceName.split("/")[1] : workspaceName;
      if (!profile || !pkg || workspace.dir !== directory || pkg.private !== true || pkg.type !== "module" || pkg.version !== profile.version ||
          !isDeepStrictEqual(pkg.dependencies ?? {}, profile.dependencies) ||
          !isDeepStrictEqual(pkg.devDependencies ?? {}, profile.devDependencies) ||
          !isDeepStrictEqual(pkg.peerDependencies ?? {}, profile.peerDependencies ?? {}) ||
          !isDeepStrictEqual(pkg.peerDependenciesMeta ?? {}, profile.peerDependenciesMeta ?? {}) ||
          Object.entries(pkg.peerDependencies ?? {}).some(([peer, range]) =>
            pkg.peerDependenciesMeta?.[peer]?.optional !== true || source.peerDependencies?.[peer] !== range || source.peerDependenciesMeta?.[peer]?.optional !== true) ||
          Object.keys(pkg.optionalDependencies ?? {}).length) {
        throw new Error("Qualified private workspace profile mismatch: " + workspaceName);
      }
    };
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
    const companions = workspaces.filter(({ pkg }) => pkg.poeCode?.safeLibraryExports?.[name]);
    const companionPeers = new Map();
    for (const { pkg } of companions) {
      if (pkg.private !== true || pkg.type !== 'module') throw new Error('Companion must be a private ESM workspace: ' + pkg.name);
      for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
        if (pkg.peerDependenciesMeta?.[peer]?.optional !== true) throw new Error('Companion provider peer must be optional: ' + peer);
        if (companionPeers.has(peer) && companionPeers.get(peer) !== range) throw new Error('Conflicting companion provider peer: ' + peer);
        companionPeers.set(peer, range);
      }
    }
    const bundled = new Map();
    const effectfulBundles = new Set();
    if (name === "safe-js") {
      const graph = await resolveBundleGraph(rootDir, workspaces, files);
      const alias = Object.fromEntries(Object.entries(graph.alias).map(([specifier, target]) => [specifier, publicSpecifier(specifier) !== specifier ? publicSpecifier(specifier) : target]));
      const entryPoints = Object.fromEntries(Object.entries(source.exports).filter(([key]) => key !== "./workerd").map(([key, target]) => [key === "." ? "index" : key.slice(2), path.join(packageDir, "src", target.import.slice("./dist/".length, -3) + ".ts")]));
      const external = [...graph.external, "@poe-platform/safe-fs"];
      const result = await bundle({ absWorkingDir: rootDir, entryPoints, alias, external, bundle: true, splitting: true, platform: "node", target: "node18.18", format: "esm", outdir: path.join(packageDir, "dist"), chunkNames: "chunks/[name]-[hash]", sourcemap: false, write: false });
      for (const output of result.outputFiles) bundled.set(output.path, output.contents);
      if (source.exports["."]?.browser) {
        const portable = await bundle({ absWorkingDir: rootDir,
          entryPoints: { "portable/core": path.join(packageDir, "src/core.ts"), "portable/modules/fs": path.join(packageDir, "src/modules/fs.ts") },
          alias, external, bundle: true, splitting: true, platform: "browser", conditions: ["workerd"],
          target: "es2022", format: "esm", outdir: path.join(packageDir, "dist"),
          chunkNames: "portable/chunks/[name]-[hash]", sourcemap: false, write: false });
        for (const output of portable.outputFiles) bundled.set(output.path, output.contents);
      }
      if (source.exports["./workerd"]) {
        const workerd = await bundle({ ...resolveWorkerdRuntimeBuild(rootDir, { alias, external }), sourcemap: false });
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
      // One canonical relative runtime owns command/value brands across entrypoints.
      // Keep it out of independently built browser and opt-in command bundles.
      const canonical = Object.keys(source.poeCode?.integration?.privateWorkspaces ?? {});
      for (const specifier of Object.keys(alias)) {
        if (canonical.some(name => specifier === name || specifier.startsWith(name + "/"))) delete alias[specifier];
      }
      external.push(...canonical);
      alias["poe-code/safe-bash/contracts"] = "safe-bash-contracts";
      alias["poe-code/safe-fs"] = "@poe-platform/safe-fs";
      const commands = resolvePrivateCommandBuild(rootDir, source.poeCode?.integration?.privateWorkspaces ?? {}, workspaces, { alias, external });
      if (commands) recipes.push(commands);
      const portableCommands = resolvePrivateCommandBuild(rootDir, source.poeCode?.integration?.privateWorkspaces ?? {}, workspaces, { alias, external, portable: true });
      if (portableCommands) recipes.push(portableCommands);
      if (Object.values(source.exports).some(value => value?.browser?.endsWith(".browser.js") || value?.workerd?.endsWith(".browser.js"))) {
        const browser = resolveBrowserShellBuild(rootDir, { external: ["@poe-platform/safe-fs", ...canonical] });
        recipes.push({ ...browser,
          alias: { ...Object.fromEntries(Object.entries(browser.alias).map(([specifier, target]) => [specifier, publicSpecifier(target)])), "@poe-code/safe-fs": "@poe-platform/safe-fs", "poe-code/safe-fs": "@poe-platform/safe-fs" },
        });
      }
      recipes.push(...resolveCommandExportBuilds(rootDir, source, root, workspaces, { alias, external }));
      if (source.sideEffects?.includes("./dist/portable-buffer.js")) recipes.push(resolvePortableBufferBuild(rootDir));
      const runtimeExports = new Map();
      for (const recipe of recipes) {
        const result = await bundle({ ...recipe, metafile: true, sourcemap: false, plugins: [privateExportStarsPlugin(runtimeExports, files, path.join(packageDir, "src")), canonicalFileSystemImports, ...(recipe.plugins ?? [])] });
        for (const metadata of Object.values(result.metafile?.outputs ?? {})) {
          if (!metadata.entryPoint || !metadata.exports?.length) continue;
          const entry = path.resolve(rootDir, metadata.entryPoint);
          for (const { dir, pkg } of workspaces) {
            if (!Object.hasOwn(source.poeCode?.integration?.privateWorkspaces ?? {}, pkg.name) || source.poeCode.integration.privateWorkspaces[pkg.name].publicAlias) continue;
            for (const [route, target] of Object.entries(pkg.exports ?? {})) {
              if (typeof target.import === "string" && path.resolve(rootDir, "packages", dir, target.import) === entry) runtimeExports.set(pkg.name + (route === "." ? "" : route.slice(1)), metadata.exports);
            }
          }
        }
        // The source package explicitly reviews its facade/chunk graph as pure,
        // except for declared initializers. Carry those effects into the chunks
        // that actually contain them; original source paths no longer exist.
        const initializers = (source.sideEffects ?? []).filter(route => route.startsWith("./src/"))
          .map(route => path.resolve(rootDir, "packages/safe-bash", route));
        for (const [filename, output] of Object.entries(result.metafile?.outputs ?? {})) {
          if (Object.entries(output.inputs).some(([input, contribution]) => contribution.bytesInOutput > 0 &&
              initializers.includes(path.resolve(rootDir, input)))) effectfulBundles.add(path.resolve(rootDir, filename));
        }
        const coreEntry = path.join(rootDir, "packages/safe-bash/dist/core.browser.js");
        const coreOutput = result.outputFiles.find(output => output.path === coreEntry);
        // A used aggregate bundle cannot discard its own dependency imports.
        // Keep the full aggregate behind a pure facade, and give lightweight
        // APIs their own public bindings so they never select that aggregate.
        if (coreOutput && result.metafile) {
          const aggregate = path.join(path.dirname(coreEntry), "full-core.browser.js");
          bundled.set(aggregate, coreOutput.contents);
          pending.push(aggregate);
          const routes = ["shell-entry.browser.js", "registry-entry.browser.js", "plugins/index.browser.js", "commands/regex-execution/public.browser.js", "commands/python/index.browser.js",
            "commands/llm/index.browser.js", "commands/llm/providers/index.browser.js"];
          const declarations = ['export * from "./full-core.browser.js";'];
          const claimed = new Set();
          for (const route of routes) {
            const filename = path.join(path.dirname(coreEntry), route);
            const metadata = Object.entries(result.metafile?.outputs ?? {}).find(([output]) => path.resolve(rootDir, output) === filename)?.[1];
            const names = (metadata?.exports ?? []).filter(name => name !== "default" && !claimed.has(name));
            for (const name of names) claimed.add(name);
            if (names.length) declarations.push(`export { ${names.join(", ")} } from ${JSON.stringify("./" + route)};`);
          }
          // Command entrypoints carry their bootstrap transitively, but their
          // own chunks must only run when that command is selected. The root
          // facade needs the shared Buffer initializer, not every command.
          const bootstrap = path.join(packageDir, "src/portable-buffer.ts");
          for (const [output, metadata] of Object.entries(result.metafile.outputs)) {
            if (!Object.entries(metadata.inputs).some(([input, contribution]) =>
              contribution.bytesInOutput > 0 && path.resolve(rootDir, input) === bootstrap)) continue;
            const filename = path.resolve(rootDir, output);
            declarations.push(`import ${JSON.stringify("./" + path.relative(path.dirname(coreEntry), filename).split(path.sep).join("/"))};`);
          }
          coreOutput.contents = new TextEncoder().encode(declarations.join("\n") + "\n");
        }
        for (const output of result.outputFiles) {
          bundled.set(output.path, output.contents);
          pending.push(output.path);
        }
      }
    }
    const enqueueExport = value => {
      if (typeof value === "string" && value.startsWith("./")) {
        const absolute = declarationSource(rootDir, path.resolve(rootDir, value));
        if (!value.includes("*")) pending.push(absolute);
        return "./" + artifactPath(rootDir, absolute);
      }
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, enqueueExport(item)]));
      return value;
    };
    const exports = {};
    for (const { dir, pkg } of companions) {
      for (const [route, entry] of Object.entries(pkg.poeCode.safeLibraryExports[name])) {
        if (!route.startsWith('./') || Object.hasOwn(source.exports, route)) throw new Error('Invalid companion public route: ' + route);
        const exported = pkg.exports?.[entry];
        if (!exported || typeof exported.import !== 'string' || !exported.types) throw new Error('Missing companion entry: ' + entry);
        const companionTarget = target => {
          if (target && typeof target === 'object' && !Array.isArray(target)) return Object.fromEntries(Object.entries(target).map(([condition, value]) => [condition, companionTarget(value)]));
          if (typeof target !== 'string' || !target.startsWith('./dist/') || target.split('/').includes('..') || target.includes('*')) throw new Error('Invalid companion entry target: ' + target);
          return enqueueExport('./packages/' + dir + '/' + target.slice(2));
        };
        exports[route] = companionTarget(exported);
      }
    }
    const imports = {};
    const workspaceTarget = value => typeof value === "string" ? value.replace("./dist/", `./packages/${name}/dist/`) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, workspaceTarget(item)])) : value;
    const importTarget = (value, types = false, owner = name) => {
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
        .map(([condition, target]) => [condition, importTarget(target, types || condition === "types", owner)]));
      if (typeof value !== "string") return value;
      if (!value.startsWith("./")) throw new Error(`Unsupported package import target: ${value}`);
      const built = types && value.startsWith("./src/") && value.endsWith(".ts")
        ? "./dist/" + value.slice(6, -3) + ".d.ts" : value;
      if (owner !== name && (!built.startsWith("./dist/") || built.slice(2).split("/").some(part => !part || part === "." || part === ".." || part.includes("\\") || part.includes("*")))) throw new Error("Invalid companion import target: " + built);
      return enqueueExport(built.replace("./dist/", `./packages/${owner}/dist/`));
    };
    if (name === "safe-js") {
      // Root SDK runtimes have their own output directory. Scoped archives own
      // the workspace builds; map only declared entries, retaining conditions.
      const runtimeEntries = new Map(Object.values(source.exports ?? {})
        .filter(target => typeof target?.import === "string" && target.import.startsWith("./dist/"))
        .map(target => [`./dist/shared/${name}/${target.import.slice("./dist/".length)}`,
          `./packages/${name}/${target.import.slice(2)}`]));
      const scopedExport = value => typeof value === "string" ? runtimeEntries.get(value) ?? value
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([condition, target]) => [condition, scopedExport(target)])) : value;
      const rootExports = Object.entries(root.exports ?? {})
        .filter(([key]) => key === "./safe-js" || key.startsWith("./safe-js/"))
        .map(([key, value]) => [key === "./safe-js" ? "." : "." + key.slice("./safe-js".length), value]);
      // Retain root compatibility policies, while publishing workspace-only
      // APIs such as /workerd that are deliberately absent from the CLI SDK.
      const scopedExports = new Map(Object.entries(source.exports).map(([key, value]) => [key, workspaceTarget(value)]));
      for (const [key, value] of rootExports) scopedExports.set(key, value);
      if (source.exports["."]?.browser) {
        for (const [key, entry] of [[".", "core"], ["./core", "core"], ["./modules/fs", "modules/fs"]]) {
          const original = scopedExports.get(key);
          const declaration = workspaceTarget(source.exports[key].types);
          scopedExports.set(key, {
            ...original,
            types: { workerd: typeof declaration === "string" ? declaration : declaration.workerd,
              browser: typeof declaration === "string" ? declaration : declaration.browser,
              default: typeof original.types === "string" ? original.types : original.types.default },
            workerd: `./packages/safe-js/dist/portable/${entry}.js`,
            browser: `./packages/safe-js/dist/portable/${entry}.js`,
          });
        }
      }
      for (const [key, value] of scopedExports) {
        // Conditions must precede the fallback import in the published manifest.
        const { types, workerd, browser, ...rest } = scopedExport(value);
        exports[key] = enqueueExport({ ...(types === undefined ? {} : { types }),
          ...(workerd === undefined ? {} : { workerd }), ...(browser === undefined ? {} : { browser }), ...rest });
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
          if (key === "." || key === "./contracts") target = { types: { workerd: "./dist/core.d.ts", browser: "./dist/core.d.ts", default: value.types?.default ?? value.types }, workerd: "./dist/core.js", browser: "./dist/core.js", import: value.import };
          if (["./node", "./fs/s3/http"].includes(key)) target = { types: { browser: "./dist/node-unavailable.d.ts", default: key === "./node" ? "./dist/node-host.d.ts" : value.types }, browser: null, import: key === "./node" ? "./dist/node-host.js" : value.import };
          if (key === "./fs/real") target = {
            types: { workerd: value.types, browser: "./dist/node-unavailable.d.ts", default: value.types },
            workerd: value.import, browser: null, import: value.import,
          };
        }
        exports[key] = enqueueExport(workspaceTarget(target));
      }
      const hasBundledBrowserShell = name === "safe-bash" && [...bundled.keys()].some(key => key.startsWith(path.join(packageDir, "dist/chunks") + path.sep) || key.endsWith(path.sep + "core.browser.js"));
      const walk = async directory => {
        for (const entry of await files.readdir(directory, { withFileTypes: true })) {
          const filename = path.join(directory, entry.name);
          if (excluded(filename)) continue;
          if (hasBundledBrowserShell && directory === path.join(packageDir, "dist") && entry.isDirectory() && entry.name === "chunks") continue;
          if (hasBundledBrowserShell && directory === path.join(packageDir, "dist") && entry.name.endsWith(".wasm") && !bundled.has(filename)) continue;
          if (entry.isDirectory()) await walk(filename);
          else if (!entry.name.endsWith(".map") && !(name === "safe-fs" && entry.name === "package.json")) pending.push(filename);
        }
      };
      await walk(path.join(packageDir, "dist"));
    }
    const addDependency = specifier => {
      const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (dependency === `@poe-platform/${name}`) return;
      if (companionPeers.has(dependency)) return;
      if (name === "safe-bash" && optional && dependency === "yaml") return;
      if (dependency === "@poe-platform/safe-js" || dependency === "@poe-platform/safe-fs") { dependencies[dependency] = version; return; }
      if (dependency === "poe-code" || privateNames.has(dependency)) throw new Error(`Private or CLI dependency leaked: ${specifier}`);
      const range = ranges[dependency];
      if (!range || range === "*" || range.startsWith("workspace:")) throw new Error(`Missing publishable dependency range: ${specifier}`);
      dependencies[dependency] = range;
    };
    const readPrivateAsset = async (workspace, relative) => {
      assertPrivateProfile(workspace, workspace.pkg.name);
      const owner = path.join(rootDir, "packages", workspace.dir);
      if (typeof relative !== "string" || !relative.startsWith("./") || relative.includes("\\") ||
          relative.slice(2).split("/").some(segment => !segment || segment === "." || segment === "..")) {
        throw new Error("Invalid private publication asset: " + relative);
      }
      const filename = path.join(owner, relative);
      if (excluded(filename)) throw new Error("Excluded package file referenced: " + relative);
      let current = owner;
      for (const segment of ["", ...relative.slice(2).split("/")]) {
        current = path.join(current, segment);
        const stat = await files.lstat(current);
        if (stat.isSymbolicLink() || (current === filename ? !stat.isFile() : !stat.isDirectory())) {
          throw new Error("Expected regular private publication asset: " + relative);
        }
      }
      return { filename, bytes: await files.readFile(filename) };
    };
    if (name === "safe-bash") {
      for (const [workspaceName, profile] of Object.entries(source.poeCode?.integration?.privateWorkspaces ?? {})) {
        const workspace = workspaces.find(({ pkg }) => pkg.name === workspaceName);
        // Public signatures can erase implementation types. Keep the admitted
        // private entrypoints available to the bundled declaration graph too.
        if (workspace) {
          assertPrivateProfile(workspace, workspaceName);
          for (const [route, target] of Object.entries(workspace.pkg.exports ?? {})) {
            if (Object.hasOwn(profile.optionalModules ?? {}, route)) continue;
            let relative = target?.types;
            while (relative && typeof relative === "object" && !Array.isArray(relative)) {
              relative = Object.entries(relative).find(([condition]) => condition === "node" || condition === "import" || condition === "default")?.[1];
            }
            if (typeof relative !== "string" || !relative.startsWith("./dist/") ||
                relative.includes("*") || !(relative.endsWith(".d.ts") || relative.endsWith(".d.mts"))) {
              throw new Error("Invalid private declaration entrypoint: " + workspaceName);
            }
            const { filename, bytes } = await readPrivateAsset(workspace, relative);
            bundled.set(filename, bytes);
            pending.push(filename);
          }
        }
        for (const relative of profile.assets ?? []) {
          assertPrivateProfile(workspace, workspaceName);
          if (typeof relative !== "string" || !relative.startsWith("./dist/")) throw new Error("Private publication assets must belong to dist: " + relative);
          const { filename, bytes } = await readPrivateAsset(workspace, relative);
          bundled.set(filename, bytes);
          pending.push(filename);
        }
      }
    }
    // Core tools may need YAML internally, while yq must still require its
    // explicitly installed optional peer. Keep that parser outside node resolution.
    const bundledYaml = path.join(rootDir, "packages/safe-bash/dist/bundled-yaml/index.js");
    while (pending.length) {
      const filename = pending.pop();
      if (excluded(filename)) throw new Error(`Excluded package file referenced: ${path.relative(packageDir, filename)}`);
      if (copied.has(filename)) continue;
      copied.add(filename);
      if (name === "safe-bash" && filename === bundledYaml) {
        const yamlRoot = path.join(rootDir, "node_modules/yaml");
        const yaml = await readJson(path.join(yamlRoot, "package.json"));
        if (yaml.name !== "yaml" || yaml.version !== source.peerDependencies.yaml) throw new Error("Bundled YAML must match the qualified optional peer version");
        const result = await bundle({ absWorkingDir: rootDir,
          stdin: { contents: 'export * from "yaml";', resolveDir: rootDir },
          outfile: bundledYaml, bundle: true, platform: "browser", format: "esm", target: "es2022", write: false });
        for (const output of result.outputFiles) bundled.set(output.path, output.contents);
        if (!bundled.has(bundledYaml)) throw new Error("Bundled YAML output missing");
        const license = path.join(path.dirname(bundledYaml), "LICENSE");
        bundled.set(license, await files.readFile(path.join(yamlRoot, "LICENSE")));
        pending.push(license);
      }
      const declaration = filename.endsWith(".js") ? filename.slice(0, -3) + ".d.ts"
        : filename.endsWith(".mjs") ? filename.slice(0, -4) + ".d.mts"
        : filename.endsWith(".cjs") ? filename.slice(0, -4) + ".d.cts" : undefined;
      if (declaration && !excluded(declaration) && (await exists(declaration) || await exists(declaration.replace("/dist/", "/src/")))) pending.push(declaration);
      const destination = path.join(directory, artifactPath(rootDir, filename));
      let contents = bundled.has(filename) ? Buffer.from(bundled.get(filename)) : await files.readFile(await exists(filename) ? filename : filename.replace("/dist/", "/src/"));
      if (filename.endsWith(".js") || filename.endsWith(".mjs") || filename.endsWith(".ts")) {
        const declaration = filename.endsWith(".d.ts") || filename.endsWith(".d.mts");
        contents = rewriteModuleSpecifiers(filename, contents.toString(), specifier => {
          if (specifier === 'cloudflare:workers') return specifier;
          if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
            if (declaration && ranges["@types/node"]) addDependency("@types/node");
            return specifier;
          }
          if (nativeAssets && specifier === nativeAssets.registry.specifier) {
            if (name !== "safe-fs") throw new Error("Filesystem implementation leaked into " + name);
            return specifier;
          }
          if (specifier === "#safe-fs-platform" || specifier === "#safe-fs-platform-path") {
            if (name !== "safe-fs") throw new Error("Filesystem implementation leaked into " + name);
            for (const profile of ["node", "browser"]) pending.push(path.join(rootDir, "packages/safe-fs/dist/platform", profile + specifier.slice("#safe-fs-platform".length) + (declaration ? ".d.ts" : ".js")));
            return specifier;
          }
          if (specifier.startsWith("#")) {
            const directOwner = workspaces.find(workspace => filename.startsWith(path.join(rootDir, "packages", workspace.dir) + path.sep));
            const owner = directOwner?.pkg.imports?.[specifier] !== undefined
              ? directOwner
              : workspaces.find(workspace => workspace.pkg.imports?.[specifier] !== undefined
                && Object.hasOwn(source.poeCode?.integration?.privateWorkspaces ?? {}, workspace.pkg.name));
            const mapping = owner?.pkg.imports?.[specifier];
            if (mapping !== undefined) {
              const target = importTarget(mapping, false, owner.dir);
              if (Object.hasOwn(imports, specifier) && !isDeepStrictEqual(imports[specifier], target)) throw new Error("Conflicting private import mapping: " + specifier);
              imports[specifier] = target;
              return specifier;
            }
          }
          const sharedRuntime = specifier.startsWith(".")
            ? rootSharedRuntimeEntries.get(path.resolve(path.dirname(filename), specifier)) : undefined;
          let publicName = publicSpecifier(sharedRuntime ?? specifier, name);
          if (name === "safe-bash" && optional && !declaration && publicName === "yaml") {
            pending.push(bundledYaml);
            const relative = path.relative(path.dirname(destination), path.join(directory, artifactPath(rootDir, bundledYaml))).split(path.sep).join("/");
            return relative.startsWith(".") ? relative : "./" + relative;
          }
          if (publicName === `@poe-platform/${name}` || publicName.startsWith(`@poe-platform/${name}/`)) return publicName;
          const qualifiedName = name === "safe-bash" && Object.keys(source.poeCode?.integration?.privateWorkspaces ?? {})
            .find(candidate => publicName === candidate || publicName.startsWith(candidate + "/"));
          if (qualifiedName) {
            const workspace = workspaces.find(({ pkg }) => pkg.name === qualifiedName);
            assertPrivateProfile(workspace, qualifiedName);
          }
          const declaredWorkspace = workspaces.find(({ pkg }) => pkg.private &&
            (publicName === pkg.name || publicName.startsWith(pkg.name + "/")) &&
            Object.hasOwn(source.devDependencies ?? {}, pkg.name));
          if (declaration || qualifiedName || name === "safe-bash" && declaredWorkspace ||
              name === "safe-fs" && publicName === canonicalXml.workspace) {
            const workspace = workspaces.find(({ pkg }) => pkg.private && (publicName === pkg.name || publicName.startsWith(pkg.name + "/")));
            if (workspace) {
              const route = "." + publicName.slice(workspace.pkg.name.length);
              let exported = workspace.pkg.exports?.[route];
              if (exported === undefined && route.startsWith("./") && workspace.pkg.exports?.["./*"]) {
                const subpath = route.slice(2);
                if (subpath.split("/").some(part => !part || part === "." || part === ".." || part === "node_modules" || part.includes("\\") || part.includes("%")))
                  throw new Error("Invalid private workspace export path: " + specifier);
                const substitute = value => typeof value === "string" ? value.replaceAll("*", subpath)
                  : value && typeof value === "object" && !Array.isArray(value)
                    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)])) : value;
                exported = substitute(workspace.pkg.exports["./*"]);
              }
              let entrypoint = declaration
                ? exported?.types !== undefined ? exported.types : (route === "." && workspace.pkg.exports === undefined ? workspace.pkg.types : undefined)
                : exported;
              while (entrypoint && typeof entrypoint === "object" && !Array.isArray(entrypoint)) {
                entrypoint = Object.entries(entrypoint).find(([condition]) => condition === "node" || condition === "import" || condition === "default")?.[1];
              }
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
          const filesystemSpecifier = name === "safe-fs" ? undefined : canonicalFileSystemSpecifier(target);
          if (filesystemSpecifier) {
            addDependency("@poe-platform/safe-fs");
            return filesystemSpecifier;
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
    if (name === "safe-bash") {
      for (const workspace of workspaces.filter(({ pkg }) => pkg.private && Object.hasOwn(source.poeCode?.integration?.privateWorkspaces ?? {}, pkg.name))) {
        for (const filename of ["LICENSE", "NOTICE"]) {
          if (!(workspace.pkg.files ?? []).includes(filename) && !await exists(path.join(rootDir, "packages", workspace.dir, filename))) continue;
          const { bytes } = await readPrivateAsset(workspace, "./" + filename);
          const destination = path.join(directory, "dist", workspace.dir, filename);
          await files.mkdir(path.dirname(destination), { recursive: true });
          await files.writeFile(destination, bytes);
        }
      }
    }
    const manifest = {
      name: `@poe-platform/${name}`, version, description: source.description ?? (name === "safe-fs" ? "Composable filesystem with a portable core and explicit Node adapters" : "Budgeted JavaScript interpreter with explicit host capabilities and resumable execution"),
      type: "module", license: root.license, engines: source.engines ?? { node: ">=18.18" },
      files: ["dist"], exports,
      repository: { type: "git", url: "git+https://github.com/poe-platform/poe-code.git", directory: `packages/${name}` },
      publishConfig: { access: "public" }, dependencies,
    };
    if (Object.keys(imports).length) manifest.imports = imports;
    if (name === "safe-bash") {
      // Private facade purity follows each reviewed owner. Core facade/chunk
      // purity follows the existing source package policy, carrying initializer
      // effects through the bundler metafile. Canonical SDK/native owners retain
      // their initialization whenever a selected facade reaches them.
      const removableOwners = workspaces.filter(({ pkg }) => pkg.sideEffects === false &&
        Object.hasOwn(source.poeCode?.integration?.privateWorkspaces ?? {}, pkg.name));
      const coreDist = path.join(rootDir, "packages/safe-bash/dist") + path.sep;
      const coreEffects = (source.sideEffects ?? []).filter(route => route.startsWith("./dist/"))
        .map(route => path.resolve(rootDir, "packages/safe-bash", route));
      manifest.sideEffects = [...copied].filter(filename =>
        (filename.endsWith(".js") || filename.endsWith(".mjs")) &&
        (effectfulBundles.has(filename) || coreEffects.includes(filename) ||
          !filename.startsWith(coreDist) && !removableOwners.some(({ dir }) =>
            filename.startsWith(path.join(rootDir, "packages", dir, "dist") + path.sep))))
        .map(filename => "./" + artifactPath(rootDir, filename)).sort();
    }
    if (companionPeers.size) {
      manifest.peerDependencies = Object.fromEntries(companionPeers);
      manifest.peerDependenciesMeta = Object.fromEntries([...companionPeers.keys()].map(peer => [peer, { optional: true }]));
    }
    if (name === "safe-fs") {
      manifest.imports = { ...imports };
      for (const suffix of ["", "-path"]) {
        const target = profile => "./dist/safe-fs/platform/" + profile + suffix;
        manifest.imports["#safe-fs-platform" + suffix] = {
          types: { workerd: target("browser") + ".d.ts", browser: target("browser") + ".d.ts", default: target("node") + ".d.ts" },
          workerd: target("browser") + ".js", browser: target("browser") + ".js", default: target("node") + ".js"
        };
      }
    }
    if (name === "safe-fs" && nativeAssets) manifest.imports[nativeAssets.registry.specifier] = nativeImportMapping(nativeAssets.registry,
      artifactPath(rootDir, path.join(rootDir, "packages/safe-fs/dist")));
    if (name === "safe-js") {
      if (source.bin) manifest.bin = Object.fromEntries(Object.entries(source.bin).map(([command, target]) => [command, "./" + artifactPath(rootDir, path.resolve(packageDir, target))]));
    }
    if (name === "safe-bash" && optional) {
      manifest.peerDependencies = { ...manifest.peerDependencies, yaml: source.peerDependencies.yaml };
      manifest.peerDependenciesMeta = { ...manifest.peerDependenciesMeta, yaml: { optional: true } };
      for (const [filename, bytes] of optional.contents) {
        const target = path.join(directory, "dist/safe-bash/opt-in", filename);
        await files.mkdir(path.dirname(target), { recursive: true });
        await files.writeFile(target, bytes);
      }
    }
    if (name === "safe-bash" && manifest.exports["./commands/playwright"]) {
      manifest.files.push("third-party");
      const attribution = path.join("third-party", "playwright");
      await files.mkdir(path.join(directory, attribution), { recursive: true });
      for (const filename of ["LICENSE", "NOTICE"]) {
        await files.copyFile(path.join(packageDir, attribution, filename), path.join(directory, attribution, filename));
      }
    }
    for (const { dir, pkg } of companions) {
      for (const notice of pkg.poeCode?.safeLibraryNotices?.[name] ?? []) {
        if (typeof notice !== 'string' || !notice.startsWith('./') || notice.split('/').includes('..')) throw new Error('Invalid companion notice: ' + notice);
        const target = path.join(directory, 'third-party', dir, notice.slice(2));
        await files.mkdir(path.dirname(target), { recursive: true });
        await files.copyFile(path.join(rootDir, 'packages', dir, notice), target);
        if (!manifest.files.includes('third-party')) manifest.files.push('third-party');
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
