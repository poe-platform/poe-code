import path from "node:path";
import ts from "typescript";
import type { LintFs } from "./model.js";
import {
  createSourceAdmission,
  fileIdentity,
  listSourceFiles,
  validateSourceExclude
} from "./source-files.js";

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
  /** True when the declaration carries import attributes (`with { type: "json" }`). */
  importAttributes: boolean;
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

export interface RawImport {
  specifier: string;
  typeOnly: boolean;
  importAttributes: boolean;
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function extractImportsFromAst(text: string, fileName: string): RawImport[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(fileName)
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
      out.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly,
        importAttributes: statement.attributes !== undefined
      });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (ts.isStringLiteralLike(statement.moduleSpecifier)) {
        let typeOnly = statement.isTypeOnly;
        if (!typeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const elements = statement.exportClause.elements;
          typeOnly = elements.length > 0 && elements.every((e) => e.isTypeOnly);
        }
        out.push({
          specifier: statement.moduleSpecifier.text,
          typeOnly,
          importAttributes: statement.attributes !== undefined
        });
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      const ref = statement.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteralLike(ref.expression)) {
        out.push({
          specifier: ref.expression.text,
          typeOnly: statement.isTypeOnly,
          importAttributes: false
        });
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
        out.push({ specifier: arg.text, typeOnly: false, importAttributes: false });
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

export function mayContainRelevantImport(
  source: string,
  workspaceNames: ReadonlySet<string>
): boolean {
  // Import attributes (`from "x" with { type: "json" }`) matter even on
  // same-package specifiers the workspace-name check below would skip.
  if (source.includes(" with {") || source.includes(" assert {")) {
    return true;
  }

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
    isTest: isTestFile(relFile),
    importAttributes: raw.importAttributes
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
    sourceExclude?: readonly string[];
  }>
): Promise<SourceImportView> {
  const view: SourceImportView = new Map();
  const admittedPackages = packages.map((pkg) => ({
    ...pkg,
    sourceExclude: validateSourceExclude(pkg.sourceExclude, pkg.dir)
  }));
  await Promise.all(
    admittedPackages.map(async ({ dir: packageDir, workspaceNames, sourceExclude }) => {
      const files = await listSourceFiles(fs, rootDir, packageDir, sourceExclude);
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

export async function scanImportFiles(
  fs: LintFs,
  rootDir: string,
  files: string[],
  packages: Array<{ dir: string; sourceExclude?: readonly string[] }> = []
): Promise<SourceImportView> {
  const view: SourceImportView = new Map();
  const descriptors = [
    ...packages.filter((pkg) => pkg.dir !== "."),
    packages.find((pkg) => pkg.dir === ".") ?? { dir: "." }
  ].map((pkg) => ({ ...pkg, sourceExclude: validateSourceExclude(pkg.sourceExclude, pkg.dir) }));
  const admissions = await Promise.all(
    descriptors.map((pkg) => createSourceAdmission(fs, rootDir, pkg.dir, pkg.sourceExclude))
  );
  const rootAdmission = admissions.at(-1)!;
  await Promise.all(
    files.map(async (relFile) => {
      const normalized = path.posix.normalize(toPosix(relFile));
      const absFile = path.join(rootDir, normalized);
      const inspected = await rootAdmission.inspect(absFile);
      if (!inspected) return;
      if (inspected.excluded)
        throw new Error(`Root entrypoint targets excluded source: ${relFile}`);
      for (const ancestor of [...inspected.entries].reverse()) {
        const owner = admissions.find(
          (admission) =>
            admission.stat && fileIdentity(admission.stat) === fileIdentity(ancestor.stat)
        );
        if (!owner) continue;
        const ownedPath = path.join(owner.packageRoot, path.relative(ancestor.path, absFile));
        const owned = await owner.inspect(ownedPath);
        if (!owned)
          throw new Error(`Unable to confirm root entrypoint ownership metadata: ${relFile}`);
        if (owned.excluded)
          throw new Error(
            `Root entrypoint targets excluded source: ${relFile} (owner: ${owner.packageRoot})`
          );
        break;
      }
      if (!inspected.entries.at(-1)!.stat.isFile())
        throw new Error(`Unsupported root entrypoint (requires a regular file): ${relFile}`);
      let text: string;
      try {
        text = await fs.readFile(absFile);
      } catch {
        return;
      }
      const refs = extractRelevantImports(text, absFile).map((raw) =>
        classify(raw, rootDir, ".", absFile, normalized)
      );
      view.set(normalized, refs);
    })
  );
  return view;
}
