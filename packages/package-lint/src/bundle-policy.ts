import { isBuiltin } from "node:module";
import path from "node:path";

export const canonicalFs = {
  workspace: "@poe-code/safe-fs",
  specifier: "poe-code/safe-fs",
  source: "packages/safe-fs/src/index.ts",
  runtime: "packages/safejs/dist/safe-fs.js",
  types: "packages/safe-fs/dist/index.d.ts"
} as const;

export interface BundleMetafile {
  inputs?: Record<string, unknown>;
  outputs?: Record<
    string,
    {
      entryPoint?: string;
      imports?: { path?: string; external?: boolean; kind?: string }[];
      inputs?: Record<string, unknown>;
      cssBundle?: string;
    }
  >;
  canonicalBundle?: { entryPoints: string[]; metafile: BundleMetafile };
}

export interface BundleIssue {
  external: string;
  reason: string;
}

interface PackageManifest {
  name: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function packageName(specifier: string): string | undefined {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    [...specifier].some((character) => character.charCodeAt(0) <= 32) ||
    [":", "\\", "?", "#", "%"].some((character) => specifier.includes(character))
  )
    return undefined;
  const parts = specifier.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return undefined;
  if (specifier.startsWith("@")) {
    if (parts.length < 2 || parts[0].length === 1) return undefined;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

export function findBundleIssues(
  manifest: PackageManifest,
  workspaceNames: ReadonlySet<string>,
  metafile: BundleMetafile,
  packedFiles: ReadonlySet<string>
): BundleIssue[] {
  const issues: BundleIssue[] = [];
  const exported = record(record(manifest.exports)["./safe-fs"]);
  const imports = new Set(
    Object.values(metafile.outputs ?? {}).flatMap((output) =>
      (output.imports ?? [])
        .filter((dependency) => dependency.external)
        .map((dependency) => dependency.path ?? "")
    )
  );
  const runtimeDependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {})
  ]);
  for (const specifier of [...imports].sort()) {
    if (isBuiltin(specifier)) continue;
    if (specifier === canonicalFs.specifier && manifest.name === "poe-code") continue;
    const dependency = packageName(specifier);
    const reason = !dependency
      ? "invalid-external"
      : dependency === manifest.name || workspaceNames.has(dependency)
        ? "workspace-not-inlined"
        : !runtimeDependencies.has(dependency)
          ? "undeclared-dependency"
          : undefined;
    if (reason) issues.push({ external: specifier, reason });
  }

  if (
    !metafile.canonicalBundle &&
    !imports.has(canonicalFs.specifier) &&
    !Object.keys(exported).length
  )
    return issues;
  const fail = (reason: string) => issues.push({ external: canonicalFs.specifier, reason });
  if (
    manifest.name !== "poe-code" ||
    exported.import !== `./${canonicalFs.runtime}` ||
    exported.types !== `./${canonicalFs.types}` ||
    Object.keys(exported).some((condition) => condition !== "import" && condition !== "types")
  ) {
    fail("invalid-canonical-export");
  }
  if (!packedFiles.has(canonicalFs.types)) fail("unpacked-canonical-types");
  if (
    [...packedFiles].some(
      (filename) =>
        filename.startsWith("packages/safe-fs/dist/") &&
        [".js", ".mjs", ".cjs"].some((extension) => filename.endsWith(extension))
    )
  )
    fail("duplicate-packed-runtime");
  if (
    Object.keys(metafile.inputs ?? {}).some((input) => input.startsWith("packages/safe-fs/src/"))
  ) {
    fail("duplicate-canonical-runtime");
  }
  const canonical = metafile.canonicalBundle;
  if (
    !canonical ||
    !Array.isArray(canonical.entryPoints) ||
    !canonical.entryPoints.includes(canonicalFs.source)
  ) {
    fail("missing-canonical-root");
    return issues;
  }
  const outputs = canonical.metafile.outputs ?? {};
  if (!Object.hasOwn(canonical.metafile.inputs ?? {}, canonicalFs.source))
    fail("missing-canonical-source");
  if (outputs[canonicalFs.runtime]?.entryPoint !== canonicalFs.source)
    fail("invalid-canonical-root");
  for (const entry of canonical.entryPoints) {
    if (!Object.values(outputs).some((output) => output.entryPoint === entry))
      fail("missing-declared-root");
  }
  const pending: string[] = [canonicalFs.runtime];
  const visited = new Set<string>();
  while (pending.length) {
    const filename = pending.pop()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    if (
      !filename.startsWith("packages/safejs/dist/") ||
      path.posix.normalize(filename) !== filename
    ) {
      fail("invalid-canonical-path");
      continue;
    }
    const output = outputs[filename];
    if (!output) {
      fail("missing-canonical-output");
      continue;
    }
    if (!packedFiles.has(filename)) fail("unpacked-canonical-output");
    if (filename.endsWith(".js")) pending.push(`${filename}.map`);
    if (
      Object.keys(output.inputs ?? {}).some((input) => !input.startsWith("packages/safe-fs/src/"))
    )
      fail("foreign-canonical-input");
    if (output.cssBundle) pending.push(output.cssBundle);
    for (const dependency of output.imports ?? []) {
      if (dependency.external) {
        if (!dependency.path || !isBuiltin(dependency.path)) fail("external-canonical-dependency");
      } else if (dependency.path) pending.push(dependency.path);
      else fail("missing-canonical-edge");
    }
  }
  return issues;
}

export async function collectPackageFiles(
  rootDir: string,
  entries: readonly string[],
  files: {
    readdir(filename: string): Promise<{ name: string; isDirectory(): boolean }[]>;
    stat?(filename: string): Promise<{ isFile(): boolean }>;
  }
): Promise<Set<string>> {
  const packed = new Set<string>();
  async function visit(filename: string, declarationsOnly: boolean): Promise<void> {
    const absolute = path.join(rootDir, filename);
    let children;
    try {
      children = await files.readdir(absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "ENOTDIR") throw error;
      if (
        (!declarationsOnly || filename.endsWith(".d.ts")) &&
        (!files.stat || (await files.stat(absolute)).isFile())
      )
        packed.add(filename);
      return;
    }
    for (const child of children) {
      const relative = path.posix.join(filename, child.name);
      if (child.isDirectory()) await visit(relative, declarationsOnly);
      else if (!declarationsOnly || child.name.endsWith(".d.ts")) packed.add(relative);
    }
  }
  for (const entry of entries) {
    const declarationsOnly = entry.endsWith("/**/*.d.ts");
    const directory = declarationsOnly ? entry.slice(0, -"/**/*.d.ts".length) : entry;
    if (
      directory.includes("*") ||
      directory.startsWith("/") ||
      directory.split("/").includes("..")
    ) {
      throw new Error(`Unsupported package files entry: ${entry}`);
    }
    await visit(directory, declarationsOnly);
  }
  return packed;
}
