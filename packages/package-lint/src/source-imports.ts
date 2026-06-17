import path from "node:path";
import ts from "typescript";
import type { LintFs } from "./model.js";

/** A single import/export/require/dynamic-import specifier found in a source file. */
export interface ImportRef {
  /** Source file, posix-relative to the workspace root. */
  file: string;
  /** The raw module specifier as written. */
  specifier: string;
  kind: "relative" | "bare";
  /** True for `import type` / type-only specifiers (erased at compile time). */
  typeOnly: boolean;
  /** True when the file is a test/spec (not shipped). */
  isTest: boolean;
  /** For bare specifiers: the package name (scope-aware), e.g. "@scope/pkg". */
  packageName?: string;
  /** For relative specifiers that resolve outside the owning package dir: where they land. */
  escapesTo?: string;
}

/** Imports found in each workspace package, keyed by the package dir (posix). */
export type SourceImportView = Map<string, ImportRef[]>;

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function barePackageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function isTestFile(relFile: string): boolean {
  const base = relFile.split("/").pop() ?? "";
  if (base.includes(".test.") || base.includes(".spec.")) return true;
  const segments = relFile.split("/");
  return segments.some((s) => s === "test" || s === "tests" || s === "__tests__");
}

interface RawImport {
  specifier: string;
  typeOnly: boolean;
}

function extractImportsFromAst(text: string, fileName: string): RawImport[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out: RawImport[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      let typeOnly = clause?.isTypeOnly ?? false;
      // `import { type A, type B } from "x"` with no default/namespace is type-only too.
      if (
        !typeOnly &&
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings)
      ) {
        const elements = clause.namedBindings.elements;
        typeOnly = elements.length > 0 && elements.every((e) => e.isTypeOnly);
      }
      out.push({ specifier: statement.moduleSpecifier.text, typeOnly });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (ts.isStringLiteralLike(statement.moduleSpecifier)) {
        let typeOnly = statement.isTypeOnly;
        if (!typeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const elements = statement.exportClause.elements;
          typeOnly = elements.length > 0 && elements.every((e) => e.isTypeOnly);
        }
        out.push({ specifier: statement.moduleSpecifier.text, typeOnly });
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      const ref = statement.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteralLike(ref.expression)) {
        out.push({ specifier: ref.expression.text, typeOnly: statement.isTypeOnly });
      }
    }
  }

  // Dynamic `import("x")` and `require("x")` anywhere in the file.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const arg = node.arguments[0];
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg)) {
        out.push({ specifier: arg.text, typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return out;
}

export function extractRelevantImports(text: string, fileName: string): RawImport[] {
  return extractImportsFromAst(text, fileName);
}

function isSourceFile(name: string): boolean {
  if (name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return false;
  return (
    name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".mts") || name.endsWith(".cts")
  );
}

async function listSourceFiles(fs: LintFs, dir: string): Promise<string[]> {
  if (fs.listFiles) {
    try {
      return (await fs.listFiles(dir)).filter((file) => isSourceFile(path.basename(file)));
    } catch {
      return [];
    }
  }
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fs, full)));
    } else if (isSourceFile(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

export function mayContainRelevantImport(
  source: string,
  workspaceNames: ReadonlySet<string>
): boolean {
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  for (const { fileName } of imports) {
    if (fileName.startsWith("../")) {
      return true;
    }

    for (const packageName of workspaceNames) {
      if (fileName === packageName || fileName.startsWith(`${packageName}/`)) {
        return true;
      }
    }
  }

  return false;
}

function classify(
  raw: RawImport,
  rootDir: string,
  packageDir: string,
  absFile: string,
  relFile: string
): ImportRef {
  const base: ImportRef = {
    file: relFile,
    specifier: raw.specifier,
    kind: raw.specifier.startsWith(".") ? "relative" : "bare",
    typeOnly: raw.typeOnly,
    isTest: isTestFile(relFile)
  };

  if (base.kind === "bare") {
    if (!raw.specifier.startsWith("node:")) base.packageName = barePackageName(raw.specifier);
    return base;
  }

  const packageAbs = path.join(rootDir, packageDir);
  const resolved = path.resolve(path.dirname(absFile), raw.specifier);
  const within = path.relative(packageAbs, resolved);
  if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    const relToRoot = toPosix(path.relative(rootDir, resolved)).split("/").filter(Boolean);
    // Only a relative import landing in a *different* workspace package is a
    // boundary violation; escaping into scripts/ or the repo root is not.
    if (relToRoot[0] === "packages" && relToRoot.length >= 2) {
      const targetDir = `packages/${relToRoot[1]}`;
      if (targetDir !== packageDir) base.escapesTo = targetDir;
    }
  }
  return base;
}

/**
 * Parse the real import graph of every workspace package's `src`, using the
 * TypeScript compiler's own parser (the engine typescript-eslint runs on). The
 * result feeds the import-driven rules — what code actually imports, not what
 * package.json declares.
 */
export async function scanSourceImports(
  fs: LintFs,
  rootDir: string,
  packages: Array<{
    dir: string;
    workspaceNames: ReadonlySet<string>;
  }>
): Promise<SourceImportView> {
  const view: SourceImportView = new Map();
  await Promise.all(
    packages.map(async ({ dir: packageDir, workspaceNames }) => {
      const srcDir = path.join(rootDir, packageDir, "src");
      const files = await listSourceFiles(fs, srcDir);
      const refs: ImportRef[] = [];
      for (const absFile of files) {
        let text: string;
        try {
          text = await fs.readFile(absFile);
        } catch {
          continue;
        }
        if (!mayContainRelevantImport(text, workspaceNames)) {
          continue;
        }
        const relFile = toPosix(path.relative(rootDir, absFile));
        for (const raw of extractRelevantImports(text, absFile)) {
          refs.push(classify(raw, rootDir, packageDir, absFile, relFile));
        }
      }
      view.set(packageDir, refs);
    })
  );
  return view;
}
