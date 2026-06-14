import type { SourceSpan } from "../../parse/parser.js";
import {
  collectSafeJSSourceModules,
  collectImportDeclarations,
  type Modules
} from "./module-registry.js";

export type Diagnostic = {
  code: "AS014";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS014(
  source: string,
  options: { filename?: string; modules?: Modules } = {}
): Diagnostic[] {
  const filename = options.filename ?? "<input>";
  const sourceModules = collectSafeJSSourceModules(options.modules);

  const currentModule = [...sourceModules.values()].find((module) => module.filename === filename);
  if (currentModule === undefined) {
    return [];
  }

  const dependencyGraph = new Map<string, readonly string[]>();
  const importDeclarations = new Map<string, ReturnType<typeof collectImportDeclarations>>();

  for (const sourceModule of sourceModules.values()) {
    const moduleSource = sourceModule.filename === filename ? source : sourceModule.source;
    const declarations = collectImportDeclarations(moduleSource, sourceModule.filename);
    importDeclarations.set(sourceModule.moduleName, declarations);
    dependencyGraph.set(sourceModule.moduleName, [
      ...new Set(
        declarations
          .map((declaration) => declaration.source.value)
          .filter((moduleName) => sourceModules.has(moduleName))
      )
    ]);
  }

  const currentImports = importDeclarations.get(currentModule.moduleName) ?? [];
  const diagnostics: Diagnostic[] = [];

  for (const declaration of currentImports) {
    const importedModuleName = declaration.source.value;
    if (!sourceModules.has(importedModuleName)) {
      continue;
    }

    const cyclePath = findPathToModule(
      importedModuleName,
      currentModule.moduleName,
      dependencyGraph,
      new Set()
    );
    if (cyclePath === undefined) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(filename, declaration.source.span, importedModuleName, [
        currentModule.moduleName,
        ...cyclePath
      ])
    );
  }

  return diagnostics;
}

function createDiagnostic(
  filename: string,
  span: SourceSpan,
  importedModuleName: string,
  cyclePath: readonly string[]
): Diagnostic {
  return {
    code: "AS014",
    severity: "error",
    message: `Import from '${importedModuleName}' participates in a cyclic dependency: ${cyclePath.join(" -> ")}.`,
    filename,
    line: span.start.line,
    column: span.start.column,
    span
  };
}

function findPathToModule(
  currentModuleName: string,
  targetModuleName: string,
  dependencyGraph: ReadonlyMap<string, readonly string[]>,
  visited: Set<string>
): string[] | undefined {
  if (currentModuleName === targetModuleName) {
    return [targetModuleName];
  }

  if (visited.has(currentModuleName)) {
    return undefined;
  }

  visited.add(currentModuleName);

  for (const dependencyModuleName of dependencyGraph.get(currentModuleName) ?? []) {
    const path = findPathToModule(dependencyModuleName, targetModuleName, dependencyGraph, visited);
    if (path !== undefined) {
      return [currentModuleName, ...path];
    }
  }

  visited.delete(currentModuleName);
  return undefined;
}
