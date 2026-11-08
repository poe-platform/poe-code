import path from "node:path";
import ts from "typescript";
import type { LintFs } from "./model.js";
import { extractRelevantImports } from "./source-imports.js";
import { publicationNodeBuiltins } from "./node-builtins.js";

export interface PortableRuntimeIssue {
  package: string;
  file: string;
  reason: "forbidden-dependency" | "ambient-buffer" | "unresolved-import";
  specifier?: string;
}
interface Manifest {
  name: string;
  exports?: unknown;
  imports?: Record<string, unknown>;
  browser?: unknown;
  module?: string;
  main?: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
interface Owner { directory: string; manifest: Manifest }

function select(value: unknown, profile: string): string | null | undefined {
  if (typeof value === "string" || value === null) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const target = select(item, profile); if (target !== undefined) return target; }
  } else if (value && typeof value === "object") {
    for (const [condition, target] of Object.entries(value)) {
      if ([profile, "worker", "browser", "import", "default"].includes(condition)) {
        const selected = select(target, profile);
        if (selected !== undefined) return selected;
      }
    }
  }
  return undefined;
}
function route(exports: unknown, name: string, profile: string): string | null | undefined {
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) return name === "." ? select(exports, profile) : undefined;
  const routes = exports as Record<string, unknown>;
  if (!Object.keys(routes).some(key => key.startsWith(".") || key.startsWith("#"))) return name === "." ? select(exports, profile) : undefined;
  if (Object.hasOwn(routes, name)) return select(routes[name], profile);
  for (const [key, value] of Object.entries(routes)) {
    const star = key.indexOf("*");
    if (star < 0 || !name.startsWith(key.slice(0, star)) || !name.endsWith(key.slice(star + 1))) continue;
    const selected = select(value, profile);
    return typeof selected === "string" ? selected.replaceAll("*", name.slice(star, name.length - (key.length - star - 1))) : selected;
  }
  return undefined;
}
function ambientBuffer(text: string, filename: string): boolean {
  if (!text.includes("Buffer")) return false;
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, filename.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const host = ts.createCompilerHost({ allowJs: true, noLib: true, noResolve: true });
  host.getSourceFile = file => file === filename ? source : undefined;
  host.fileExists = file => file === filename;
  host.readFile = file => file === filename ? text : undefined;
  const checker = ts.createProgram([filename], { allowJs: true, noLib: true, noResolve: true }, host).getTypeChecker();
  let found = false;
  const pending: ts.Node[] = [source];
  while (pending.length && !found) {
    const node = pending.pop()!;
    if (ts.isTypeNode(node)) continue;
    if (ts.isIdentifier(node) && node.text === "Buffer") {
      const parent = node.parent;
      const property = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const key = ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node)
        || (ts.isBindingElement(parent) && parent.propertyName === node);
      if (property) {
        if (ts.isIdentifier(parent.expression) && ["globalThis", "global"].includes(parent.expression.text) && !checker.getSymbolAtLocation(parent.expression)?.declarations?.length) found = true;
      } else if (!key && !checker.getSymbolAtLocation(node)) found = true;
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ["globalThis", "global"].includes(node.expression.text) &&
        ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "Buffer" && !checker.getSymbolAtLocation(node.expression)?.declarations?.length) found = true;
    ts.forEachChild(node, child => { pending.push(child); });
  }
  return found;
}

/** Inspect actual portable artifacts, including conditional and transitive imports. */
export async function scanPortableRuntime(fs: LintFs, rootDir: string): Promise<PortableRuntimeIssue[]> {
  const owners = new Map<string, Owner>();
  const manifests = new Map<string, Owner | undefined>();
  const readOwner = async (directory: string): Promise<Owner | undefined> => {
    if (manifests.has(directory)) return manifests.get(directory);
    let owner: Owner | undefined;
    try { owner = { directory, manifest: JSON.parse(await fs.readFile(path.join(directory, "package.json"))) as Manifest }; } catch { /* Missing dependency is reported at its importing edge. */ }
    manifests.set(directory, owner);
    return owner;
  };
  const root = await readOwner(rootDir);
  if (root) owners.set(root.manifest.name, root);
  for (const entry of await fs.readdir(path.join(rootDir, "packages")).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const owner = await readOwner(path.join(rootDir, "packages", entry.name));
    if (owner) owners.set(owner.manifest.name, owner);
  }
  const workspaceOwners = [...owners.values()].sort((a, b) => b.directory.length - a.directory.length);
  const issues = new Map<string, PortableRuntimeIssue>();
  const sources = new Map<string, { refs: ReturnType<typeof extractRelevantImports>; buffer: boolean } | undefined>();
  const visited = new Set<string>();
  const sourceBuffers = new Map<string, boolean>();
  const report = (owner: Owner, filename: string, reason: PortableRuntimeIssue["reason"], specifier?: string): void => {
    const file = path.relative(rootDir, filename).split(path.sep).join("/");
    const issue = { package: owner.manifest.name, file, reason, ...(specifier === undefined ? {} : { specifier }) };
    issues.set(JSON.stringify(issue), issue);
  };
  const visit = async (filename: string, owner: Owner, profile: string): Promise<void> => {
    if (!filename.includes(path.sep + "node_modules" + path.sep)) {
      owner = workspaceOwners.find(candidate => filename.startsWith(candidate.directory + path.sep)) ?? owner;
    }
    const key = profile + ":" + filename;
    if (visited.has(key)) return;
    visited.add(key);
    if ([".wasm", ".json", ".css"].some(extension => filename.endsWith(extension))) return;
    if (!sources.has(filename)) {
      let source;
      try { const text = await fs.readFile(filename); source = { refs: extractRelevantImports(text, filename), buffer: ambientBuffer(text, filename) }; } catch { /* Try Node-style extensionless package modules below. */ }
      if (!source && ![".js", ".mjs", ".cjs", ".ts"].some(extension => filename.endsWith(extension))) {
        for (const candidate of [filename + ".js", filename + ".mjs", path.join(filename, "index.js")]) {
          try {
            await fs.readFile(candidate);
          } catch { continue; }
          await visit(candidate, owner, profile);
          return;
        }
      }
      sources.set(filename, source);
    }
    const source = sources.get(filename);
    if (!source) { report(owner, filename, "unresolved-import", filename); return; }
    if (source.buffer) report(owner, filename, "ambient-buffer");
    const originalFiles = new Set<string>();
    const relative = path.relative(owner.directory, filename).split(path.sep).join("/");
    if (relative.startsWith("dist/") && filename.endsWith(".js")) originalFiles.add(path.join(owner.directory, "src", relative.slice(5, -3) + ".ts"));
    try {
      const map = JSON.parse(await fs.readFile(filename + ".map")) as { sources?: unknown; sourceRoot?: string };
      if (Array.isArray(map.sources)) for (const input of map.sources) {
        if (typeof input === "string") originalFiles.add(path.resolve(path.dirname(filename), map.sourceRoot ?? "", input));
      }
    } catch { /* Source maps are optional; emitted runtime checks remain mandatory. */ }
    for (const original of originalFiles) {
      const within = path.relative(rootDir, original).split(path.sep).join("/");
      if (!within.startsWith("packages/") || within.includes("/node_modules/") || !within.includes("/src/") || within.includes(".test.") || within.includes(".spec.")) continue;
      if (!sourceBuffers.has(original)) {
        let buffer = false;
        try { buffer = ambientBuffer(await fs.readFile(original), original); } catch { /* Installed artifacts need not include source. */ }
        sourceBuffers.set(original, buffer);
      }
      if (sourceBuffers.get(original)) report(owner, original, "ambient-buffer");
    }
    for (const ref of source.refs) {
      if (ref.typeOnly) continue;
      const specifier = ref.specifier;
      if (profile === "workerd" && specifier === "cloudflare:workers") continue;
      if (specifier.startsWith("node:") || publicationNodeBuiltins.has(specifier) || ["fs-extra", "graceful-fs", "memfs"].some(name => specifier === name || specifier.startsWith(name + "/"))) {
        report(owner, filename, "forbidden-dependency", specifier); continue;
      }
      if (specifier.startsWith(".")) { await visit(path.resolve(path.dirname(filename), specifier), owner, profile); continue; }
      if (specifier.startsWith("#")) {
        const target = route(owner.manifest.imports, specifier, profile);
        if (typeof target === "string" && target.startsWith(".")) await visit(path.resolve(owner.directory, target), owner, profile);
        else report(owner, filename, "unresolved-import", specifier);
        continue;
      }
      const parts = specifier.split("/");
      const name = parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
      const subpath = "." + specifier.slice(name.length);
      // Optional peers are explicit host capabilities, not owned portable code.
      if (owner.manifest.peerDependencies?.[name] && owner.manifest.peerDependenciesMeta?.[name]?.optional === true) continue;
      let dependency = owners.get(name);
      if (!dependency && ["@poe-platform/safe-fs", "@poe-platform/safe-js"].includes(name)) {
        dependency = owners.get(name.replace("@poe-platform/", "@poe-code/"));
      }
      if (!dependency) {
        let directory = owner.directory;
        while (!dependency) {
          dependency = await readOwner(path.join(directory, "node_modules", name));
          const parent = path.dirname(directory);
          if (parent === directory) break;
          directory = parent;
        }
      }
      if (!dependency) { report(owner, filename, "unresolved-import", specifier); continue; }
      const pkg = dependency.manifest;
      const target = pkg.exports === undefined ? subpath === "." ? typeof pkg.browser === "string" ? pkg.browser : pkg.module ?? pkg.main ?? "index.js" : subpath : route(pkg.exports, subpath, profile);
      if (typeof target !== "string") { report(owner, filename, "unresolved-import", specifier); continue; }
      await visit(path.resolve(dependency.directory, target), dependency, profile);
    }
  };
  for (const owner of owners.values()) {
    const name = owner.manifest.name.split("/").at(-1)!;
    if (!(name.startsWith("safe-bash") || name.endsWith("-ast") || name === "safe-fs" || name === "safe-js" || name.startsWith("safe-playwright"))) continue;
    const exports = owner.manifest.exports;
    const routes = exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith(".")) ? Object.values(exports) : [exports ?? owner.manifest.main];
    for (const profile of ["workerd", "browser"]) for (const value of routes) {
      const target = select(value, profile);
      if (typeof target !== "string" || target.endsWith(".d.ts")) continue;
      if (!target.includes("*")) { await visit(path.resolve(owner.directory, target), owner, profile); continue; }
      const pattern = path.resolve(owner.directory, target);
      const star = pattern.indexOf("*");
      const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
      const walk = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory).catch(() => [])) {
          const filename = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(filename);
          else if (filename.startsWith(prefix) && filename.endsWith(suffix)) {
            const match = filename.slice(prefix.length, filename.length - suffix.length);
            const entries = Object.entries(exports as Record<string, unknown>);
            const exportName = entries.find(([, candidate]) => candidate === value)?.[0]?.replaceAll("*", match);
            if (exportName && route(exports, exportName, profile) !== null) await visit(filename, owner, profile);
          }
        }
      };
      await walk(path.dirname(prefix + "entry"));
    }
  }
  return [...issues.values()];
}
