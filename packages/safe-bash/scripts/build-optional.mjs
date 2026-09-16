import * as fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import glob from "fast-glob";
import ts from "typescript";
import { rewriteModuleSpecifiers } from "../../../scripts/package-safe.mjs";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

function below(directory, filename) {
  return filename.startsWith(directory + path.sep);
}

function declarationTarget(filename) {
  return filename.endsWith(".js") ? filename.slice(0, -3) + ".d.ts" : filename;
}

function moduleEdges(filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length || source.referencedFiles.length || source.typeReferenceDirectives.length) {
    throw new Error(`Unsupported module syntax: ${filename}`);
  }
  const edges = [];
  const visit = node => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      throw new Error(`Unsupported external import-equals: ${filename}`);
    }
    let literal, names, asset = false;
    if (ts.isImportDeclaration(node)) {
      literal = node.moduleSpecifier;
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings) && !node.importClause.name) {
        names = bindings.elements.map(element => (element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportDeclaration(node)) {
      literal = node.moduleSpecifier;
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        names = node.exportClause.elements.map(element => (element.propertyName ?? element.name).text);
      }
    } else if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument)) throw new Error(`Nonliteral module reference: ${filename}`);
      literal = node.argument.literal;
      let qualifier = node.qualifier;
      while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
      if (qualifier && ts.isIdentifier(qualifier)) names = [qualifier.text];
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      literal = node.arguments[0];
      if (!literal) throw new Error(`Nonliteral module reference: ${filename}`);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const base = node.arguments?.[1];
      if (base && ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression) && base.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
        literal = node.arguments?.[0];
        asset = true;
        if (!literal) throw new Error(`Nonliteral module reference: ${filename}`);
      }
    }
    if (literal) {
      if (!ts.isStringLiteral(literal)) throw new Error(`Nonliteral module reference: ${filename}`);
      edges.push({ specifier: literal.text, names, asset });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const lastStatement = source.statements.at(-1);
  const trailing = text.slice(lastStatement?.end ?? 0);
  const mapComments = ts.getLeadingCommentRanges(trailing, 0) ?? [];
  for (const comment of mapComments.toReversed()) {
    const contents = trailing.slice(comment.pos, comment.end);
    if (contents.startsWith("//# sourceMappingURL=") || contents.startsWith("//@ sourceMappingURL=")) {
      const offset = lastStatement?.end ?? 0;
      text = text.slice(0, offset + comment.pos) + text.slice(offset + comment.end);
    }
  }
  return { edges, text };
}

export async function buildOptionalPackage({ rootDir, compile, fileSystem = fs }) {
  if (typeof compile !== "function") throw new Error("A fresh maintained compiler callback is required");
  const root = path.resolve(rootDir);
  const core = path.join(root, "packages/safe-bash");
  const filesystem = path.join(root, "packages/safe-fs");
  const output = path.join(core, "dist/opt-in");
  await assertSafeOutputDirectory(core, output, {
    lstat: async filename => fileSystem.lstatSync(filename),
    realpath: async filename => fileSystem.realpathSync(filename),
  });
  const observed = new Map();
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const regular = filename => {
    if (!below(root, filename)) throw new Error(`Input outside workspace: ${filename}`);
    let current = root;
    for (const component of path.relative(root, filename).split(path.sep)) {
      current = path.join(current, component);
      const stat = fileSystem.lstatSync(current);
      if (stat.isSymbolicLink() || (current === filename ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())) {
        throw new Error(`Expected nonlink regular single-link input: ${filename}`);
      }
    }
    const bytes = fileSystem.readFileSync(filename);
    const digest = hash(bytes);
    if (observed.has(filename) && observed.get(filename) !== digest) throw new Error(`Input changed: ${filename}`);
    observed.set(filename, digest);
    return bytes;
  };
  const json = filename => JSON.parse(regular(filename).toString());
  const coreManifest = json(path.join(core, "package.json"));
  const fsManifest = json(path.join(filesystem, "package.json"));
  const peers = {
    "@poe-platform/safe-bash": coreManifest.version,
    "@poe-platform/safe-fs": coreManifest.devDependencies?.["@poe-code/safe-fs"],
    yaml: coreManifest.peerDependencies?.yaml,
  };
  const yamlOptional = coreManifest.peerDependenciesMeta?.yaml?.optional === true;
  for (const peer of ["@poe-platform/safe-bash", "@poe-platform/safe-fs"]) {
    if (typeof peers[peer] !== "string" || !peers[peer]) throw new Error(`Missing public peer: ${peer}`);
  }
  const configPath = path.join(core, "tsconfig.optional.json");
  const config = ts.readConfigFile(configPath, filename => regular(filename).toString());
  const parsed = ts.parseJsonConfigFileContent(config.config, {
    useCaseSensitiveFileNames: true,
    readDirectory: () => { throw new Error("Optional compilation must declare explicit roots"); },
    fileExists: filename => fileSystem.existsSync(filename),
    readFile: filename => regular(filename).toString(),
  }, core, undefined, configPath);
  if (config.error || parsed.errors.length || parsed.fileNames.length !== 1 ||
      parsed.fileNames[0] !== path.join(core, "src/optional.ts") ||
      parsed.options.rootDir !== path.join(core, "src") || parsed.options.outDir !== path.join(core, "dist") ||
      !parsed.options.declaration || parsed.options.noEmit || parsed.options.emitDeclarationOnly) {
    throw new Error("Compilation must match the declared optional config");
  }
  const dist = parsed.options.outDir;
  const entry = path.relative(parsed.options.rootDir, parsed.fileNames[0]).slice(0, -3);
  const roots = [`${entry}.js`, `${entry}.d.ts`];
  const exclusions = (coreManifest.files ?? []).filter(value => value.startsWith("!")).map(value => {
    const relative = value.slice(1);
    const filename = path.resolve(core, relative);
    if (path.isAbsolute(relative) || glob.isDynamicPattern(relative) || !below(dist, filename)) {
      throw new Error(`Unsupported package file exclusion: ${value}`);
    }
    return filename;
  });
  const optionalOwned = filename => exclusions.some(excluded => filename === excluded || below(excluded, filename));
  const compilation = await compile({ root: core, profile: "optional", fileSystem });
  if (compilation?.status !== 0 || !Array.isArray(compilation.rootNames) || !Array.isArray(compilation.emittedFiles)) {
    throw new Error("Successful maintained compilation required");
  }
  if (compilation.rootNames.length !== 1 || compilation.rootNames[0] !== parsed.fileNames[0]) {
    throw new Error("Compilation must match the declared optional config");
  }
  if (!compilation.inputHashes || !compilation.emittedHashes ||
      !compilation.inputHashes[parsed.fileNames[0]] || !compilation.inputHashes[configPath] ||
      compilation.emittedFiles.some(filename => !compilation.emittedHashes[filename])) {
    throw new Error("Missing compilation byte binding");
  }
  for (const bindings of [compilation.inputHashes, compilation.emittedHashes]) {
    for (const [filename, digest] of Object.entries(bindings)) {
      if (hash(regular(filename)) !== digest) throw new Error(`Input changed: ${filename}`);
    }
  }
  for (const filename of observed.keys()) regular(filename);
  const emitted = new Set(compilation.emittedFiles);
  const publicImports = new Set();
  const requirePeer = specifier => {
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    if (typeof peers[name] !== "string" || !peers[name]) throw new Error(`Undeclared peer import: ${specifier}`);
    publicImports.add(specifier);
    return specifier;
  };
  const routes = (owner, declaration) => Object.entries(owner.exports ?? {}).map(([key, value]) => {
    let target = value;
    while (target && typeof target === "object" && !Array.isArray(target)) {
      target = declaration && target.types !== undefined ? target.types : target.import ?? target.default;
    }
    return { key, target };
  }).filter(route => typeof route.target === "string");
  const publicRoute = (owner, directory, filename, declaration) => {
    for (const { key, target } of routes(owner, declaration).sort((left, right) => Number(left.key.includes("*")) - Number(right.key.includes("*")))) {
      const absolute = path.resolve(directory, target);
      const parts = absolute.split("*");
      let route;
      if (parts.length === 1 && absolute === filename) route = key;
      else if (parts.length === 2 && key.split("*").length === 2 && filename.startsWith(parts[0]) && filename.endsWith(parts[1])) {
        route = key.replace("*", filename.slice(parts[0].length, filename.length - parts[1].length));
      }
      if (route) {
        if (!target.startsWith("./dist/") || !below(path.join(directory, "dist"), filename)) throw new Error(`Invalid public target: ${target}`);
        regular(filename);
        return route === "." ? "" : route.slice(1);
      }
    }
  };
  const supportBinding = (filename, names, declaration) => {
    const target = coreManifest.exports?.["./optional-host"]?.[declaration ? "types" : "import"];
    if (!target || !names?.length || !target.startsWith("./dist/")) return false;
    const support = path.resolve(core, target);
    if (!below(dist, support) || optionalOwned(support)) return false;
    const source = ts.createSourceFile(support, regular(support).toString(), ts.ScriptTarget.Latest, true);
    const provided = new Set();
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      const from = path.resolve(path.dirname(support), statement.moduleSpecifier.text);
      if ((declaration ? declarationTarget(from) : from) !== filename) continue;
      for (const element of statement.exportClause.elements) {
        if (!element.propertyName || element.propertyName.text === element.name.text) provided.add(element.name.text);
      }
    }
    if (names.every(name => provided.has(name))) {
      regular(filename);
      return true;
    }
    return false;
  };
  const pending = roots.map(name => ({ filename: path.join(dist, name), asset: false }));
  const selected = new Map();
  while (pending.length) {
    const { filename, asset } = pending.pop();
    if (selected.has(filename)) continue;
    if (!below(dist, filename) || !optionalOwned(filename)) throw new Error(`Not optional-owned: ${filename}`);
    if (emitted.has(filename) && (filename.endsWith(".js.map") || filename.endsWith(".d.ts.map"))) throw new Error(`Compiler map assets are not published: ${filename}`);
    const module = filename.endsWith(".js") || filename.endsWith(".d.ts");
    if (module && !emitted.has(filename)) throw new Error(`Not in successful compiler output: ${filename}`);
    if (!module && !asset) throw new Error(`Unsupported module target: ${filename}`);
    const source = !module && !emitted.has(filename) ? path.join(parsed.options.rootDir, path.relative(dist, filename)) : filename;
    let contents = regular(source);
    selected.set(filename, contents);
    if (!module) continue;
    const declaration = filename.endsWith(".d.ts");
    const parsedModule = moduleEdges(filename, contents.toString());
    const replacements = new Map();
    for (const edge of parsedModule.edges) {
      const { specifier } = edge;
      let replacement = specifier;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        let target = path.resolve(path.dirname(filename), specifier);
        if (declaration && !edge.asset) target = declarationTarget(target);
        if (!below(dist, target)) throw new Error(`Module escapes core output: ${specifier}`);
        if (optionalOwned(target)) pending.push({ filename: target, asset: edge.asset });
        else {
          if (edge.asset) throw new Error(`Unmapped core asset: ${specifier}`);
          const route = publicRoute(coreManifest, core, target, declaration);
          if (route !== undefined) replacement = requirePeer("@poe-platform/safe-bash" + route);
          else if (supportBinding(target, edge.names, declaration)) replacement = requirePeer("@poe-platform/safe-bash/optional-host");
          else throw new Error(`Unmapped core boundary: ${filename} -> ${specifier}`);
        }
      } else if (specifier.startsWith("node:") && builtinModules.includes(specifier.slice(5))) {
        if (edge.asset) throw new Error(`Unsupported asset reference: ${specifier}`);
      } else {
        if (edge.asset) throw new Error(`Unsupported asset reference: ${specifier}`);
        const aliases = ["poe-code/safe-fs", "@poe-code/safe-fs", "@poe-platform/safe-fs", "@poe-platform/safe-bash"];
        const alias = aliases.find(name => specifier === name || specifier.startsWith(name + "/"));
        if (alias) {
          const isCore = alias === "@poe-platform/safe-bash";
          const owner = isCore ? coreManifest : fsManifest;
          const directory = isCore ? core : filesystem;
          const key = "." + specifier.slice(alias.length);
          let resolved;
          for (const route of routes(owner, declaration)) {
            const parts = route.key.split("*");
            if (route.key === key) resolved = path.resolve(directory, route.target);
            else if (parts.length === 2 && key.startsWith(parts[0]) && key.endsWith(parts[1])) resolved = path.resolve(directory, route.target.replace("*", key.slice(parts[0].length, key.length - parts[1].length)));
          }
          if (!resolved || (isCore && optionalOwned(resolved)) || publicRoute(owner, directory, resolved, declaration) === undefined) throw new Error(`Unexported peer route: ${specifier}`);
          replacement = requirePeer((isCore ? "@poe-platform/safe-bash" : "@poe-platform/safe-fs") + specifier.slice(alias.length));
        } else {
          if (specifier !== "yaml" || !yamlOptional) throw new Error(`Unmapped external import: ${specifier}`);
          requirePeer(specifier);
        }
      }
      if (replacements.has(specifier) && replacements.get(specifier) !== replacement) throw new Error(`Ambiguous module boundary: ${specifier}`);
      replacements.set(specifier, replacement);
    }
    contents = Buffer.from(rewriteModuleSpecifiers(filename, parsedModule.text, specifier => replacements.get(specifier) ?? specifier));
    selected.set(filename, contents);
  }
  const entrypoints = new Map();
  for (const extension of [".js", ".d.ts"]) {
    const filename = path.join(dist, "optional" + extension);
    const source = ts.createSourceFile(filename, selected.get(filename).toString(), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const parts = specifier.split("/");
      const name = parts[1] === "commands" || parts[1] === "fs" ? parts[2] : parts[1] === "shell" && parts[2] === "extensions" ? parts[3] : undefined;
      if (!name) continue;
      const target = path.join(dist, "entrypoints", name + extension);
      const text = rewriteModuleSpecifiers(filename, statement.getText(source), reference => reference.startsWith("./") ? "../" + reference.slice(2) : reference);
      entrypoints.set(target, (entrypoints.get(target) ?? "") + text + "\n");
    }
  }
  for (const [filename, text] of entrypoints) selected.set(filename, Buffer.from(text));
  const files = [...selected.keys()].map(filename => path.relative(dist, filename)).sort();
  const inspectOutput = directory => {
    if (!fileSystem.existsSync(directory)) return;
    if (!fileSystem.lstatSync(directory).isDirectory() || fileSystem.lstatSync(directory).isSymbolicLink()) throw new Error(`Unsafe output directory: ${directory}`);
    for (const name of fileSystem.readdirSync(directory)) {
      const filename = path.join(directory, name);
      const stat = fileSystem.lstatSync(filename);
      if (stat.isSymbolicLink()) throw new Error(`Unsafe output member: ${filename}`);
      if (stat.isDirectory()) inspectOutput(filename);
      else {
        if (stat.nlink !== 1) throw new Error(`Expected single-link output: ${filename}`);
        if (!stat.isFile() || !files.includes(path.relative(output, filename))) throw new Error(`Unexpected existing output member: ${filename}`);
      }
    }
  };
  inspectOutput(output);
  for (const filename of observed.keys()) regular(filename);
  for (const [filename, contents] of selected) {
    const target = path.join(output, path.relative(dist, filename));
    fileSystem.mkdirSync(path.dirname(target), { recursive: true });
    fileSystem.writeFileSync(target, contents);
  }
  return { status: 0, files, emittedFiles: files.map(filename => path.join(output, filename)), peerImports: [...publicImports].sort(), compilerMaps: "omitted after specifier rewriting" };
}
