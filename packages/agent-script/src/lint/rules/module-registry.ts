import { parseModule, type ImportDeclaration } from "../../parse/parser.js";

export type Modules = ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>;

export function collectImportDeclarations(source: string, filename: string): ImportDeclaration[] {
  const module = parseModule(source, filename);
  return module.body.flatMap((statement) => (statement.type === "ImportDeclaration" ? [statement] : []));
}

export function createUnknownModuleMessage(moduleName: string, moduleNames: readonly string[]): string {
  if (moduleNames.length === 0) {
    return `Unknown module '${moduleName}'. No modules are registered.`;
  }

  return `Unknown module '${moduleName}'. Available modules: ${moduleNames.join(", ")}.`;
}

export function createUnknownExportMessage(
  moduleName: string,
  exportName: string,
  availableExports: readonly string[]
): string {
  if (availableExports.length === 0) {
    return `Module '${moduleName}' does not export '${exportName}'. The module exports nothing.`;
  }

  return `Module '${moduleName}' does not export '${exportName}'. Available exports: ${availableExports.join(", ")}.`;
}

export function normalizeModules(modules: Modules | undefined): Map<string, string[]> {
  if (modules === undefined) {
    return new Map();
  }

  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
  const normalized = new Map<string, string[]>();

  for (const [moduleName, exportedNames] of entries) {
    normalized.set(moduleName, dedupeAndSort(exportedNames));
  }

  return normalized;
}

function dedupeAndSort(exportedNames: readonly string[]): string[] {
  return [...new Set(exportedNames)].sort((left, right) => left.localeCompare(right));
}
