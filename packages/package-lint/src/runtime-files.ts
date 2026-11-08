import path from "node:path";
import ts from "typescript";
import type { LintFs } from "./model.js";
import { listSourceFiles, validateSourceExclude } from "./source-files.js";

export type RuntimeFileAssetKind = "file" | "directory";

export interface RuntimeFileAssetRef {
  packageDir: string;
  packageName: string;
  sourceFile: string;
  kind: RuntimeFileAssetKind;
  sourceRelPath?: string;
  runtimeRelPath: string;
  expression: string;
  inferred: true;
  externalPackageRelPath?: string;
  isTest: boolean;
}

export interface RuntimeAssetDeclaration {
  sourceRelPath?: string;
  runtimeRelPath: string;
  kind?: RuntimeFileAssetKind;
}

export type RuntimeFileAssetView = Map<string, RuntimeFileAssetRef[]>;

type Value = { kind: "strings"; values: string[] } | { kind: "unknown" };

interface Symbols {
  fsNamespaces: Set<string>;
  fileOps: Set<string>;
  dirOps: Set<string>;
  pathNamespaces: Set<string>;
  pathFunctions: Map<string, string>;
  urlFunctions: Set<string>;
  bindings: Map<string, Value>;
}

const fileOperationNames = new Set([
  "readFile",
  "readFileSync",
  "createReadStream",
  "open",
  "openSync",
  "stat",
  "statSync",
  "access",
  "accessSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync"
]);
const directoryOperationNames = new Set(["readdir", "readdirSync", "opendir", "opendirSync"]);
const pathFunctionNames = new Set(["join", "resolve", "dirname"]);

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function isTestFile(relFile: string): boolean {
  const base = relFile.split("/").pop() ?? "";
  if (base.includes(".test.") || base.includes(".spec.")) return true;
  const segments = relFile.split("/");
  return segments.some((s) => s === "test" || s === "tests" || s === "__tests__");
}

function isNodeModule(specifier: string, bare: string): boolean {
  return specifier === bare || specifier === `node:${bare}`;
}

export function mayContainRuntimeFileAsset(source: string): boolean {
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  return imports.some(
    ({ fileName }) => isNodeModule(fileName, "fs") || isNodeModule(fileName, "fs/promises")
  );
}

function collectImportSymbols(sourceFile: ts.SourceFile): Symbols {
  const symbols: Symbols = {
    fsNamespaces: new Set(),
    fileOps: new Set(),
    dirOps: new Set(),
    pathNamespaces: new Set(),
    pathFunctions: new Map(),
    urlFunctions: new Set(),
    bindings: new Map()
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (isNodeModule(specifier, "path")) {
      if (clause.name) symbols.pathNamespaces.add(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          symbols.pathNamespaces.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            if (pathFunctionNames.has(imported))
              symbols.pathFunctions.set(element.name.text, imported);
          }
        }
      }
      continue;
    }
    if (isNodeModule(specifier, "url")) {
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === "fileURLToPath") symbols.urlFunctions.add(element.name.text);
        }
      }
      continue;
    }
    if (isNodeModule(specifier, "fs") || isNodeModule(specifier, "fs/promises")) {
      if (clause.name) symbols.fsNamespaces.add(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          symbols.fsNamespaces.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            const local = element.name.text;
            if (fileOperationNames.has(imported)) symbols.fileOps.add(local);
            if (directoryOperationNames.has(imported)) symbols.dirOps.add(local);
          }
        }
      }
    }
  }
  return symbols;
}

function withoutConstAssertion(node: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return withoutConstAssertion(node.expression);
  }
  return node;
}

function combine(values: string[][], reducer: (items: string[]) => string): string[] {
  let rows: string[][] = [[]];
  for (const valueSet of values) {
    const next: string[][] = [];
    for (const row of rows) for (const value of valueSet) next.push([...row, value]);
    rows = next;
  }
  return rows.map(reducer);
}

function pathPropertyName(expression: ts.Expression, symbols: Symbols): string | undefined {
  if (ts.isIdentifier(expression)) return symbols.pathFunctions.get(expression.text);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    symbols.pathNamespaces.has(expression.expression.text)
  ) {
    return expression.name.text;
  }
  return undefined;
}

function isImportMetaUrl(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "url" &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === "meta"
  );
}

function isImportMetaDirname(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "dirname" &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === "meta"
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function evaluate(
  node: ts.Expression,
  symbols: Symbols,
  sourceDir: string,
  packageAbs: string
): Value {
  const expression = withoutConstAssertion(node);
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { kind: "strings", values: [expression.text] };
  }
  if (isImportMetaDirname(expression)) return { kind: "strings", values: [sourceDir] };
  if (isImportMetaUrl(expression))
    return { kind: "strings", values: [path.join(sourceDir, "__file__")] };
  if (ts.isIdentifier(expression))
    return symbols.bindings.get(expression.text) ?? { kind: "unknown" };
  if (ts.isArrayLiteralExpression(expression)) {
    const values: string[] = [];
    for (const element of expression.elements) {
      const evaluated = evaluate(element, symbols, sourceDir, packageAbs);
      if (evaluated.kind === "unknown") return evaluated;
      values.push(...evaluated.values);
    }
    return { kind: "strings", values: dedupe(values) };
  }
  if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression)) {
    if (expression.expression.text !== "URL") return { kind: "unknown" };
    const [target, base] = expression.arguments ?? [];
    if (!target || !base || !isImportMetaUrl(base)) return { kind: "unknown" };
    const evaluatedTarget = evaluate(target, symbols, sourceDir, packageAbs);
    if (evaluatedTarget.kind === "unknown") return evaluatedTarget;
    return {
      kind: "strings",
      values: dedupe(evaluatedTarget.values.map((value) => path.resolve(sourceDir, value)))
    };
  }
  if (ts.isCallExpression(expression)) {
    if (
      ts.isIdentifier(expression.expression) &&
      symbols.urlFunctions.has(expression.expression.text) &&
      expression.arguments[0]
    ) {
      return evaluate(expression.arguments[0], symbols, sourceDir, packageAbs);
    }
    const pathFunction = pathPropertyName(expression.expression, symbols);
    if (pathFunction) {
      const evaluatedArgs = expression.arguments.map((arg) =>
        evaluate(arg, symbols, sourceDir, packageAbs)
      );
      if (evaluatedArgs.some((value) => value.kind === "unknown")) return { kind: "unknown" };
      const values = evaluatedArgs.map(
        (value) => (value as { kind: "strings"; values: string[] }).values
      );
      if (pathFunction === "dirname") {
        return {
          kind: "strings",
          values: dedupe(values[0]?.map((value) => path.dirname(value)) ?? [])
        };
      }
      if (pathFunction === "join") {
        return { kind: "strings", values: dedupe(combine(values, (items) => path.join(...items))) };
      }
      if (pathFunction === "resolve") {
        return {
          kind: "strings",
          values: dedupe(combine(values, (items) => path.resolve(packageAbs, ...items)))
        };
      }
    }
  }
  return { kind: "unknown" };
}

function collectConstBindings(
  node: ts.Node,
  symbols: Symbols,
  sourceDir: string,
  packageAbs: string
): void {
  const visit = (current: ts.Node): void => {
    if (ts.isVariableStatement(current)) {
      for (const declaration of current.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const value = evaluate(declaration.initializer, symbols, sourceDir, packageAbs);
        if (value.kind === "strings") symbols.bindings.set(declaration.name.text, value);
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

function classifyAsset(input: {
  value: string;
  kind: RuntimeFileAssetKind;
  expression: string;
  packageDir: string;
  packageName: string;
  packageAbs: string;
  rootDir: string;
  sourceFile: string;
  isTest: boolean;
}): RuntimeFileAssetRef | undefined {
  const abs = path.isAbsolute(input.value)
    ? path.normalize(input.value)
    : path.resolve(input.packageAbs, input.value);
  const effectiveKind =
    input.kind === "file" && !path.basename(abs).includes(".") ? "directory" : input.kind;
  const rootRel = toPosix(path.relative(input.rootDir, abs));
  if (rootRel === ".." || rootRel.startsWith("../") || path.isAbsolute(rootRel)) return undefined;
  const packageRel = toPosix(path.relative(input.packageAbs, abs));
  if (packageRel !== ".." && !packageRel.startsWith("../") && !path.isAbsolute(packageRel)) {
    let runtimeRelPath = packageRel;
    if (packageRel === "src") runtimeRelPath = "dist";
    if (packageRel.startsWith("src/")) runtimeRelPath = `dist/${packageRel.slice(4)}`;
    return {
      packageDir: input.packageDir,
      packageName: input.packageName,
      sourceFile: input.sourceFile,
      kind: effectiveKind,
      sourceRelPath: packageRel,
      runtimeRelPath,
      expression: input.expression,
      inferred: true,
      isTest: input.isTest
    };
  }
  return {
    packageDir: input.packageDir,
    packageName: input.packageName,
    sourceFile: input.sourceFile,
    kind: effectiveKind,
    runtimeRelPath: rootRel,
    expression: input.expression,
    inferred: true,
    externalPackageRelPath: rootRel,
    isTest: input.isTest
  };
}

function fsOperationKind(
  expression: ts.Expression,
  symbols: Symbols
): RuntimeFileAssetKind | undefined {
  if (ts.isIdentifier(expression)) {
    if (symbols.fileOps.has(expression.text)) return "file";
    if (symbols.dirOps.has(expression.text)) return "directory";
    return undefined;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    symbols.fsNamespaces.has(expression.expression.text)
  ) {
    if (fileOperationNames.has(expression.name.text)) return "file";
    if (directoryOperationNames.has(expression.name.text)) return "directory";
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "promises" &&
    ts.isIdentifier(expression.expression.expression) &&
    symbols.fsNamespaces.has(expression.expression.expression.text)
  ) {
    if (fileOperationNames.has(expression.name.text)) return "file";
    if (directoryOperationNames.has(expression.name.text)) return "directory";
  }
  return undefined;
}

function expressionText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return sourceFile.text.slice(node.getStart(sourceFile), node.getEnd());
}

function addEvaluatedAssets(input: {
  out: RuntimeFileAssetRef[];
  arg: ts.Expression | undefined;
  kind: RuntimeFileAssetKind;
  symbols: Symbols;
  sourceDir: string;
  packageDir: string;
  packageName: string;
  packageAbs: string;
  rootDir: string;
  sourceFile: string;
  sourceFileAst: ts.SourceFile;
  isTest: boolean;
  seen: Set<string>;
}): void {
  if (!input.arg) return;
  const evaluated = evaluate(input.arg, input.symbols, input.sourceDir, input.packageAbs);
  if (evaluated.kind === "unknown") return;
  const expression = expressionText(input.sourceFileAst, input.arg);
  for (const value of evaluated.values) {
    const ref = classifyAsset({ ...input, value, expression });
    if (!ref) continue;
    const key = `${ref.sourceFile}\0${ref.kind}\0${ref.runtimeRelPath}`;
    if (input.seen.has(key)) continue;
    input.seen.add(key);
    input.out.push(ref);
  }
}

function scanAstForAssets(
  sourceFileAst: ts.SourceFile,
  symbols: Symbols,
  rootDir: string,
  packageDir: string,
  packageName: string,
  absFile: string,
  relFile: string
): RuntimeFileAssetRef[] {
  const out: RuntimeFileAssetRef[] = [];
  const packageAbs = path.join(rootDir, packageDir);
  const sourceDir = path.dirname(absFile);
  const isTest = isTestFile(relFile);
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const declarations = node.initializer.declarations;
      if (declarations.length === 1 && ts.isIdentifier(declarations[0].name)) {
        const set = evaluate(node.expression, symbols, sourceDir, packageAbs);
        if (set.kind === "strings") {
          const previous = symbols.bindings.get(declarations[0].name.text);
          symbols.bindings.set(declarations[0].name.text, set);
          ts.forEachChild(node.statement, visit);
          if (previous) symbols.bindings.set(declarations[0].name.text, previous);
          else symbols.bindings.delete(declarations[0].name.text);
          return;
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const operationKind = fsOperationKind(node.expression, symbols);
      if (operationKind) {
        addEvaluatedAssets({
          out,
          arg: node.arguments[0],
          kind: operationKind,
          symbols,
          sourceDir,
          packageDir,
          packageName,
          packageAbs,
          rootDir,
          sourceFile: relFile,
          sourceFileAst,
          isTest,
          seen
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFileAst);
  return out;
}

export async function scanRuntimeFileAssets(
  fs: LintFs,
  rootDir: string,
  packages: Array<{ name: string; dir: string; sourceExclude?: readonly string[] }>
): Promise<RuntimeFileAssetView> {
  const view: RuntimeFileAssetView = new Map();
  const admittedPackages = packages.map((pkg) => ({
    ...pkg,
    sourceExclude: validateSourceExclude(pkg.sourceExclude, pkg.dir)
  }));
  await Promise.all(
    admittedPackages.map(async (pkg) => {
      const files = await listSourceFiles(fs, rootDir, pkg.dir, pkg.sourceExclude);
      const refs: RuntimeFileAssetRef[] = [];
      for (const absFile of files) {
        let text: string;
        try {
          text = await fs.readFile(absFile);
        } catch {
          continue;
        }
        if (!mayContainRuntimeFileAsset(text)) {
          continue;
        }
        const relFile = toPosix(path.relative(rootDir, absFile));
        const ast = ts.createSourceFile(
          absFile,
          text,
          ts.ScriptTarget.Latest,
          false,
          absFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        );
        const symbols = collectImportSymbols(ast);
        collectConstBindings(ast, symbols, path.dirname(absFile), path.join(rootDir, pkg.dir));
        refs.push(...scanAstForAssets(ast, symbols, rootDir, pkg.dir, pkg.name, absFile, relFile));
      }
      view.set(pkg.dir, refs);
    })
  );
  return view;
}
