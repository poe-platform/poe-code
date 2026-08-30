import { isBuiltin } from "node:module";
import path from "node:path";
import type ts from "typescript";

export const canonicalFsRoutes = [
  {
    workspace: "@poe-code/safe-fs",
    specifier: "poe-code/safe-fs",
    key: "./safe-fs",
    source: { node: "packages/safe-fs/src/index.ts", browser: "packages/safe-fs/src/core.ts" },
    runtime: {
      node: "packages/safejs/dist/safe-fs.js",
      browser: "packages/safejs/dist/browser/safe-fs.js"
    },
    types: { node: "packages/safe-fs/dist/index.d.ts", browser: "packages/safe-fs/dist/core.d.ts" }
  },
  {
    workspace: "@poe-code/safe-fs/core",
    specifier: "poe-code/safe-fs/core",
    key: "./safe-fs/core",
    source: { node: "packages/safe-fs/src/core.ts", browser: "packages/safe-fs/src/core.ts" },
    runtime: {
      node: "packages/safejs/dist/safe-fs-core.js",
      browser: "packages/safejs/dist/browser/safe-fs-core.js"
    },
    types: { node: "packages/safe-fs/dist/core.d.ts", browser: "packages/safe-fs/dist/core.d.ts" }
  },
  {
    workspace: "@poe-code/safe-fs/node",
    specifier: "poe-code/safe-fs/node",
    key: "./safe-fs/node",
    source: { node: "packages/safe-fs/src/node-host.ts", browser: null },
    runtime: { node: "packages/safejs/dist/safe-fs-node.js", browser: null },
    types: {
      node: "packages/safe-fs/dist/node-host.d.ts",
      browser: "packages/safe-fs/dist/node-unavailable.d.ts"
    }
  }
] as const;

export const canonicalFsProfiles = {
  node: {
    outdir: "packages/safejs/dist",
    policy: "packages/safe-fs/src/platform/node.ts",
    types: "packages/safe-fs/dist/platform/node.d.ts"
  },
  browser: {
    outdir: "packages/safejs/dist/browser",
    policy: "packages/safe-fs/src/platform/browser.ts",
    types: "packages/safe-fs/dist/platform/browser.d.ts"
  }
} as const;

export const canonicalFsExports = Object.fromEntries(
  canonicalFsRoutes.map((route) => [
    route.key,
    {
      types: { browser: `./${route.types.browser}`, default: `./${route.types.node}` },
      browser: route.runtime.browser === null ? null : `./${route.runtime.browser}`,
      import: `./${route.runtime.node}`
    }
  ])
);

const nodeOnlySafeJsExports = Object.fromEntries(
  [
    ["./safejs", "index"],
    ["./safejs/core", "core"],
    ["./safejs/cli", "cli"]
  ].map(([route, entry]) => [
    route,
    {
      types: {
        browser: "./packages/safe-fs/dist/node-unavailable.d.ts",
        default: `./packages/safejs/dist/${entry}.d.ts`
      },
      browser: null,
      import: `./packages/safejs/dist/${entry}.js`
    }
  ])
);

export const canonicalFsTypeImports = {
  "#safe-fs-platform": {
    types: {
      browser: `./${canonicalFsProfiles.browser.types}`,
      default: `./${canonicalFsProfiles.node.types}`
    },
    default: null
  }
};

export const canonicalFs = {
  workspace: "@poe-code/safe-fs",
  specifier: "poe-code/safe-fs",
  source: "packages/safe-fs/src/index.ts",
  runtime: "packages/safejs/dist/safe-fs.js",
  types: "packages/safe-fs/dist/index.d.ts",
  routes: canonicalFsRoutes
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
  browserCanonicalBundle?: { entryPoints: string[]; metafile: BundleMetafile };
  canonicalTypes?: Record<string, string[]>;
  canonicalEmptyTypes?: string[];
}

export interface BundleIssue {
  external: string;
  reason: string;
}

interface PackageManifest {
  name: string;
  exports?: unknown;
  imports?: unknown;
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
  const exported = record(manifest.exports);
  const routes = new Set<string>(canonicalFsRoutes.map((route) => route.specifier));
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
    if (routes.has(specifier) && manifest.name === "poe-code") continue;
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
  const exportKeys = Object.keys(exported).filter(
    (key) => key === "./safe-fs" || key.startsWith("./safe-fs/")
  );
  if (
    !metafile.canonicalBundle &&
    !metafile.browserCanonicalBundle &&
    !exportKeys.length &&
    ![...imports].some((specifier) => routes.has(specifier))
  )
    return issues;
  const fail = (reason: string, external: string = canonicalFs.specifier) => {
    if (!issues.some((issue) => issue.external === external && issue.reason === reason))
      issues.push({ external, reason });
  };
  for (const route of canonicalFsRoutes) {
    if (
      manifest.name !== "poe-code" ||
      JSON.stringify(exported[route.key]) !== JSON.stringify(canonicalFsExports[route.key])
    )
      fail("invalid-canonical-export", route.specifier);
  }
  if (exportKeys.some((key) => !canonicalFsRoutes.some((route) => route.key === key)))
    fail("invalid-canonical-export");
  for (const [key, expected] of Object.entries(nodeOnlySafeJsExports)) {
    if (JSON.stringify(exported[key]) !== JSON.stringify(expected))
      fail("invalid-node-only-safejs-export", `poe-code${key.slice(1)}`);
  }
  if (
    JSON.stringify(record(manifest.imports)["#safe-fs-platform"]) !==
    JSON.stringify(canonicalFsTypeImports["#safe-fs-platform"])
  )
    fail("invalid-canonical-type-import");
  const canonicalPaths = canonicalFsRoutes
    .flatMap((route) => [...Object.values(route.runtime), ...Object.values(route.types)])
    .filter((filename) => filename !== null);
  for (const filename of canonicalPaths) {
    let directory = path.posix.dirname(filename);
    while (directory !== ".") {
      if (packedFiles.has(`${directory}/package.json`)) fail("nested-canonical-package-scope");
      directory = path.posix.dirname(directory);
    }
  }
  if (
    [...packedFiles].some(
      (filename) =>
        filename.startsWith("packages/safe-fs/dist/") &&
        [".js", ".mjs", ".cjs"].some((extension) => filename.endsWith(extension))
    )
  )
    fail("duplicate-packed-runtime");
  if (Object.keys(metafile.inputs ?? {}).some((input) => input.startsWith("packages/safe-fs/src/")))
    fail("duplicate-canonical-runtime");
  const emptyTypes = "packages/safe-fs/dist/node-unavailable.d.ts";
  if (!metafile.canonicalEmptyTypes?.includes(emptyTypes))
    fail("nonempty-browser-node-types", "poe-code/safe-fs/node");

  for (const profile of ["node", "browser"] as const) {
    const settings = canonicalFsProfiles[profile];
    const canonical =
      profile === "node" ? metafile.canonicalBundle : metafile.browserCanonicalBundle;
    if (!canonical || !Array.isArray(canonical.entryPoints)) {
      fail("missing-canonical-root");
      continue;
    }
    const inputs = canonical.metafile.inputs ?? {};
    if (
      !Object.hasOwn(inputs, settings.policy) ||
      Object.hasOwn(inputs, canonicalFsProfiles[profile === "node" ? "browser" : "node"].policy)
    )
      fail("wrong-canonical-policy");
    const outputs = canonical.metafile.outputs ?? {};
    for (const singleton of [
      "contracts/errors.ts",
      "bridge/filesystem.ts",
      "fs/memory/index.ts",
      "fs/mount/comparison.ts",
      "fs/s3/registry.ts",
      "fs/s3/authority.ts",
      `platform/${profile}.ts`
    ]) {
      const source = `packages/safe-fs/src/${singleton}`;
      if (!Object.hasOwn(inputs, source)) continue;
      const copies = Object.entries(outputs).filter(
        ([filename, output]) =>
          packedFiles.has(filename) && Object.hasOwn(output.inputs ?? {}, source)
      );
      if (copies.length > 1) fail("duplicate-canonical-singleton");
    }
    const pending: string[] = [];
    for (const route of canonicalFsRoutes) {
      const source = route.source[profile];
      const runtime = route.runtime[profile];
      if (source === null || runtime === null) continue;
      if (!canonical.entryPoints.includes(source)) fail("missing-canonical-root", route.specifier);
      if (!Object.hasOwn(inputs, source)) fail("missing-canonical-source", route.specifier);
      if (outputs[runtime]?.entryPoint !== source) fail("invalid-canonical-root", route.specifier);
      pending.push(runtime);
    }
    for (const entry of canonical.entryPoints) {
      if (!Object.values(outputs).some((output) => output.entryPoint === entry))
        fail("missing-declared-root");
    }
    const rootedOutputs = new Set<string>();
    const rootedPending = Object.entries(outputs)
      .filter(
        ([, output]) => output.entryPoint && canonical.entryPoints.includes(output.entryPoint)
      )
      .map(([filename]) => filename);
    while (rootedPending.length) {
      const filename = rootedPending.pop()!;
      if (rootedOutputs.has(filename)) continue;
      rootedOutputs.add(filename);
      for (const dependency of outputs[filename]?.imports ?? []) {
        if (!dependency.external && dependency.path) rootedPending.push(dependency.path);
      }
    }
    for (const [filename, output] of Object.entries(outputs)) {
      if (output.entryPoint && !rootedOutputs.has(filename) && packedFiles.has(filename))
        fail("undeclared-canonical-root");
    }
    const visited = new Set<string>();
    while (pending.length) {
      const filename = pending.pop()!;
      if (visited.has(filename)) continue;
      visited.add(filename);
      if (
        !filename.startsWith(`${settings.outdir}/`) ||
        path.posix.normalize(filename) !== filename ||
        (profile === "node" && filename.startsWith(`${canonicalFsProfiles.browser.outdir}/`))
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
          if (profile === "browser" || !dependency.path || !isBuiltin(dependency.path))
            fail("external-canonical-dependency");
        } else if (dependency.path) pending.push(dependency.path);
        else fail("missing-canonical-edge");
      }
    }

    const typeQueue: string[] = canonicalFsRoutes.map((route) => route.types[profile]);
    typeQueue.push(settings.types);
    const seenTypes = new Set<string>();
    while (typeQueue.length) {
      const filename = typeQueue.pop()!;
      if (seenTypes.has(filename)) continue;
      seenTypes.add(filename);
      if (
        !filename.startsWith("packages/safe-fs/dist/") ||
        path.posix.normalize(filename) !== filename ||
        !filename.endsWith(".d.ts")
      ) {
        fail("invalid-canonical-types-path");
        continue;
      }
      if (!packedFiles.has(filename)) fail("unpacked-canonical-types");
      const edges = metafile.canonicalTypes?.[filename];
      if (!Array.isArray(edges)) {
        fail("missing-canonical-types");
        continue;
      }
      for (const edge of edges) {
        if (edge === "#safe-fs-platform") typeQueue.push(settings.types);
        else if (isBuiltin(edge)) {
          if (profile === "browser") fail("external-canonical-types");
        } else if (
          edge.startsWith(".") &&
          !["?", "#", "%", "\\", ":"].some((character) => edge.includes(character)) &&
          (edge.endsWith(".js") || edge.endsWith(".d.ts"))
        ) {
          const target = edge.endsWith(".js") ? `${edge.slice(0, -3)}.d.ts` : edge;
          typeQueue.push(
            path.posix.normalize(path.posix.join(path.posix.dirname(filename), target))
          );
        } else fail("external-canonical-types");
      }
    }
  }
  return issues;
}

export async function collectCanonicalDeclarations(
  rootDir: string,
  files: {
    readdir(filename: string): Promise<{ name: string; isDirectory(): boolean }[]>;
    readFile(filename: string): Promise<string>;
  }
): Promise<Pick<BundleMetafile, "canonicalTypes" | "canonicalEmptyTypes">> {
  const { default: ts } = await import("typescript");
  const declarations = await collectPackageFiles(
    rootDir,
    ["packages/safe-fs/dist/**/*.d.ts"],
    files
  );
  const canonicalTypes: Record<string, string[]> = {};
  const canonicalEmptyTypes: string[] = [];
  for (const filename of declarations) {
    const source = ts.createSourceFile(
      filename,
      await files.readFile(path.join(rootDir, filename)),
      ts.ScriptTarget.Latest,
      true
    );
    const imports = new Set<string>(source.referencedFiles.map((reference) => reference.fileName));
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.add(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        imports.add(node.argument.literal.text);
      if (
        ts.isExternalModuleReference(node) &&
        node.expression &&
        ts.isStringLiteral(node.expression)
      )
        imports.add(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const reference of source.typeReferenceDirectives)
      imports.add(`types:${reference.fileName}`);
    canonicalTypes[filename] = [...imports];
    if (
      source.statements.length === 1 &&
      source.statements.every(
        (statement) =>
          ts.isExportDeclaration(statement) &&
          !statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length === 0
      )
    )
      canonicalEmptyTypes.push(filename);
  }
  return { canonicalTypes, canonicalEmptyTypes };
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
