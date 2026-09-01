import * as fs from "node:fs/promises";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import semver from "semver";
import ts from "typescript";
import { build } from "esbuild";
import { resolveBundleGraph } from "./bundle-graph.mjs";

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
  const results = [];
  const fsManifest = workspaces.find(workspace => workspace.dir === "safe-fs").pkg;
  for (const name of ["safe-fs", "safe-js", "safe-bash"]) {
    const packageDir = path.join(rootDir, "packages", name);
    const source = await readJson(path.join(packageDir, "package.json"));
    const directory = path.join(outDir, name);
    await files.mkdir(outDir, { recursive: true });
    await files.mkdir(directory);
    const pending = [];
    const copied = new Set();
    const dependencies = {};
    const bundled = new Map();
    if (name === "safe-js") {
      const graph = await resolveBundleGraph(rootDir, workspaces, files);
      const alias = Object.fromEntries(Object.entries(graph.alias).map(([specifier, target]) => [specifier, publicSpecifier(specifier) !== specifier ? publicSpecifier(specifier) : target]));
      const entryPoints = Object.fromEntries(Object.entries(source.exports).map(([key, target]) => [key === "." ? "index" : key.slice(2), path.join(packageDir, "src", target.import.slice("./dist/".length, -3) + ".ts")]));
      const result = await bundle({ absWorkingDir: rootDir, entryPoints, alias, external: [...graph.external, "@poe-platform/safe-fs"], bundle: true, splitting: true, platform: "node", target: "node18.18", format: "esm", outdir: path.join(packageDir, "dist"), chunkNames: "chunks/[name]-[hash]", sourcemap: true, write: false });
      for (const output of result.outputFiles) bundled.set(output.path, output.contents);
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
    const workspaceTarget = value => typeof value === "string" ? value.replace("./dist/", `./packages/${name}/dist/`) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, workspaceTarget(item)])) : value;
    if (name === "safe-js") {
      for (const [key, value] of Object.entries(root.exports)) {
        if (key === "./safe-js" || key.startsWith("./safe-js/")) exports[key === "./safe-js" ? "." : "." + key.slice("./safe-js".length)] = enqueueExport(value);
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
        let target = value;
        if (name === "safe-fs") {
          if (key === "." || key === "./contracts") target = { types: { browser: "./dist/core.d.ts", default: value.types }, browser: "./dist/core.js", import: value.import };
          if (["./node", "./fs/real", "./fs/s3", "./fs/s3/http"].includes(key)) target = { types: { browser: "./dist/node-unavailable.d.ts", default: key === "./node" ? "./dist/node-host.d.ts" : value.types }, browser: null, import: key === "./node" ? "./dist/node-host.js" : value.import };
        }
        exports[key] = enqueueExport(workspaceTarget(target));
      }
      if (name === "safe-bash" && root.exports["./safe-bash/browser"]) exports["./browser"] = enqueueExport(root.exports["./safe-bash/browser"]);
      const walk = async directory => {
        for (const entry of await files.readdir(directory, { withFileTypes: true })) {
          const filename = path.join(directory, entry.name);
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
      if (copied.has(filename)) continue;
      copied.add(filename);
      if (bundled.has(filename + ".map") || await exists(filename + ".map")) pending.push(filename + ".map");
      const destination = path.join(directory, artifactPath(rootDir, filename));
      let contents = bundled.has(filename) ? Buffer.from(bundled.get(filename)) : await files.readFile(filename);
      if (filename.endsWith(".js") || filename.endsWith(".mjs") || filename.endsWith(".ts")) {
        const declaration = filename.endsWith(".d.ts") || filename.endsWith(".d.mts");
        contents = rewriteModuleSpecifiers(filename, contents.toString(), specifier => {
          if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
            if (declaration && ranges["@types/node"]) addDependency("@types/node");
            return specifier;
          }
          if (specifier === "#safe-fs-platform") {
            if (name !== "safe-fs") throw new Error("Filesystem implementation leaked into " + name);
            for (const profile of ["node", "browser"]) pending.push(path.join(rootDir, "packages/safe-fs/dist/platform", profile + (declaration ? ".d.ts" : ".js")));
            return specifier;
          }
          const publicName = publicSpecifier(specifier);
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
    if (name === "safe-fs") manifest.imports = { "#safe-fs-platform": { types: { browser: "./dist/safe-fs/platform/browser.d.ts", default: "./dist/safe-fs/platform/node.d.ts" }, browser: "./dist/safe-fs/platform/browser.js", default: "./dist/safe-fs/platform/node.js" } };
    if (name === "safe-js") {
      if (source.bin) manifest.bin = Object.fromEntries(Object.entries(source.bin).map(([command, target]) => [command, "./" + artifactPath(rootDir, path.resolve(packageDir, target))]));
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { "out-dir": { type: "string" }, version: { type: "string" } } });
  if (!values["out-dir"] || !values.version) throw new Error("Usage: node scripts/package-safe.mjs --out-dir <directory> --version <version>");
  console.log(JSON.stringify(await packageSafeLibraries({ rootDir: fileURLToPath(new URL("../", import.meta.url)), outDir: path.resolve(values["out-dir"]), version: values.version }), null, 2));
}
