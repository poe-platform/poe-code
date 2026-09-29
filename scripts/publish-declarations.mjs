import path from "node:path";
import * as fileSystem from "node:fs/promises";
import ts from "typescript";
import { assertSafeOutputDirectory } from "./guard-package-dist.mjs";
import { createSourceAdmission, validateSourceExclude } from "../packages/package-lint/dist/source-files.js";

// Public declarations belong to the root package; workspace tsc owns its dist.
export function declarationSource(rootDir, filename) {
  const relative = path.relative(path.join(rootDir, "dist/types"), filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return filename;
  const [workspace, ...parts] = relative.split(path.sep);
  return path.join(rootDir, "packages", workspace, "dist", ...parts);
}

function declarationOutput(rootDir, filename) {
  const relative = path.relative(path.join(rootDir, "packages"), filename).split(path.sep);
  if (relative[0] === ".." || relative[1] !== "dist") return filename;
  return path.join(rootDir, "dist/types", relative[0], ...relative.slice(2));
}

function typeTargets(value) {
  if (typeof value === "string") return [".d.ts", ".d.mts", ".d.cts"].some(extension => value.endsWith(extension)) ? [value] : [];
  return value && typeof value === "object" ? Object.values(value).flatMap(typeTargets) : [];
}

function nodeTarget(value) {
  if (!value || typeof value !== "object") return value;
  for (const condition of ["types", "node", "import", "default"])
    if (Object.hasOwn(value, condition)) return nodeTarget(value[condition]);
}

function exportTarget(pkg, key) {
  let target = pkg.exports?.[key];
  if (target === undefined) {
    for (const [pattern, candidate] of Object.entries(pkg.exports ?? {})) {
      const parts = pattern.split("*");
      if (parts.length !== 2 || !key.startsWith(parts[0]) || !key.endsWith(parts[1])) continue;
      const selected = nodeTarget(candidate);
      return typeof selected === "string" ? selected.replaceAll("*", key.slice(parts[0].length, key.length - parts[1].length)) : selected;
    }
    if (key === "." && pkg.exports === undefined) target = pkg.types;
  }
  return nodeTarget(target);
}

export async function publishDeclarations(rootDir, manifest, workspaces, { files = fileSystem } = {}) {
  const root = path.resolve(rootDir);
  const pending = [];
  const outputs = new Map();
  const visited = new Set();
  const admissions = new Map();
  const inspect = async filename => {
    const workspace = workspaces.find(({ dir }) => filename.startsWith(path.join(root, "packages", dir) + path.sep));
    const directory = workspace ? `packages/${workspace.dir}` : ".";
    if (!admissions.has(directory)) admissions.set(directory, await createSourceAdmission(files, root, directory,
      validateSourceExclude(workspace?.pkg.poeCode?.packageLint?.sourceExclude, directory)));
    const inspected = await admissions.get(directory).inspect(filename);
    if (!inspected || inspected.excluded) throw new Error(`Unadmitted public declaration input: ${filename}`);
  };
  const exists = async filename => {
    try { return (await files.stat(filename)).isFile(); }
    catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw error; }
  };
  const resolveDeclaration = async filename => {
    const source = declarationSource(root, filename);
    const extension = ["js", "mjs", "cjs"].find(extension => source.endsWith("." + extension));
    const candidates = typeTargets(source).length ? [source]
      : extension ? [source.slice(0, -extension.length) + "d." + (extension === "js" ? "ts" : extension === "mjs" ? "mts" : "cts")]
      : [source + ".d.ts", path.join(source, "index.d.ts")];
    for (const candidate of candidates) if (await exists(candidate)) return candidate;
    throw new Error(`Missing public declaration: ${source}`);
  };
  const enqueueTarget = async target => {
    const absolute = declarationSource(root, path.resolve(root, target));
    const parts = absolute.split("*");
    if (parts.length === 1) { pending.push(await resolveDeclaration(absolute)); return; }
    if (parts.length !== 2) throw new Error(`Unsupported declaration export pattern: ${target}`);
    const directory = path.dirname(parts[0]);
    const visit = async directory => {
      await inspect(directory);
      for (const entry of await files.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(filename);
        else if (filename.startsWith(parts[0]) && filename.endsWith(parts[1])) pending.push(filename);
      }
    };
    await visit(directory);
  };
  for (const target of new Set(typeTargets([manifest.exports, manifest.imports]))) await enqueueTarget(target);
  while (pending.length) {
    const filename = pending.pop();
    if (visited.has(filename)) continue;
    visited.add(filename);
    const output = declarationOutput(root, filename);
    if (!output.startsWith(path.join(root, "dist") + path.sep))
      throw new Error(`Public declaration must be owned by root dist: ${output}`);
    await inspect(filename);
    const text = await files.readFile(filename, "utf8");
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
    const literals = [];
    const visit = node => {
      const literal = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
        : ts.isExternalModuleReference(node) ? node.expression : undefined;
      if (literal && ts.isStringLiteral(literal)) literals.push(literal);
      ts.forEachChild(node, visit);
    };
    visit(source);
    const replacements = [];
    for (const literal of literals) {
      const specifier = literal.text;
      let target;
      if (specifier.startsWith(".")) target = path.resolve(path.dirname(filename), specifier);
      else {
        const workspace = workspaces.find(({ pkg }) => specifier === pkg.name || specifier.startsWith(pkg.name + "/"));
        if (workspace) {
          const suffix = specifier.slice(workspace.pkg.name.length);
          const exported = exportTarget(workspace.pkg, "." + suffix);
          if (typeof exported !== "string") throw new Error(`Missing or blocked workspace declaration export: ${specifier}`);
          target = path.resolve(root, "packages", workspace.dir, exported);
        }
      }
      if (!target) continue;
      const dependency = await resolveDeclaration(target);
      pending.push(dependency);
      let relative = path.relative(path.dirname(output), declarationOutput(root, dependency)).split(path.sep).join("/");
      if (!relative.startsWith(".")) relative = "./" + relative;
      const extension = relative.endsWith(".d.mts") ? ".mjs" : relative.endsWith(".d.cts") ? ".cjs" : ".js";
      replacements.push({ start: literal.getStart(source), end: literal.end, value: JSON.stringify(relative.slice(0, extension === ".js" ? -5 : -6) + extension) });
    }
    for (const reference of source.referencedFiles) {
      const dependency = await resolveDeclaration(path.resolve(path.dirname(filename), reference.fileName));
      pending.push(dependency);
      const relative = path.relative(path.dirname(output), declarationOutput(root, dependency)).split(path.sep).join("/");
      replacements.push({ start: reference.pos, end: reference.end, value: relative });
    }
    let rewritten = text;
    for (const replacement of replacements.sort((left, right) => right.start - left.start))
      rewritten = rewritten.slice(0, replacement.start) + replacement.value + rewritten.slice(replacement.end);
    outputs.set(output, rewritten);
  }
  const directory = path.join(root, "dist/types");
  await assertSafeOutputDirectory(root, directory, files);
  for (const filename of outputs.keys()) await assertSafeOutputDirectory(root, filename, files);
  await files.rm(directory, { recursive: true, force: true });
  for (const [filename, text] of outputs) {
    await files.mkdir(path.dirname(filename), { recursive: true });
    await files.writeFile(filename, text);
  }
  return new Set(outputs.keys());
}
