import { parseModule, type ImportDeclaration } from "../../parse/parser.js";

export type ModuleRegistration =
  | readonly string[]
  | {
      exports?: readonly string[] | LintModuleExports;
      filename?: string;
      source?: string;
    };

export type Modules = ReadonlyMap<string, ModuleRegistration> | Record<string, ModuleRegistration>;
export type LintModuleExport =
  | string
  | {
      async?: boolean;
      type?: string;
    };
export type LintModuleExports =
  | ReadonlyMap<string, LintModuleExport>
  | Record<string, LintModuleExport>;
export type ModuleExportTypes = LintModuleExports;

export type NormalizedModuleRegistration = {
  asyncExports: ReadonlySet<string>;
  exports: string[];
  exportTypes: ReadonlyMap<string, string>;
  filename?: string;
  source?: string;
};

export type SafeJSSourceModule = {
  moduleName: string;
  exports: readonly string[];
  filename: string;
  source: string;
};

export function collectImportDeclarations(source: string, filename: string): ImportDeclaration[] {
  const module = parseModule(source, filename);
  return module.body.flatMap((statement) =>
    statement.type === "ImportDeclaration" ? [statement] : []
  );
}

export function createUnknownModuleMessage(
  moduleName: string,
  moduleNames: readonly string[]
): string {
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
  return new Map(
    [...normalizeModuleRegistrations(modules).entries()].map(([moduleName, registration]) => [
      moduleName,
      registration.exports
    ])
  );
}

export function normalizeModuleRegistrations(
  modules: Modules | undefined
): Map<string, NormalizedModuleRegistration> {
  if (modules === undefined) {
    return new Map();
  }

  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
  const normalized = new Map<string, NormalizedModuleRegistration>();

  for (const [moduleName, registration] of entries) {
    normalized.set(moduleName, normalizeModuleRegistration(registration));
  }

  return normalized;
}

export function collectSafeJSSourceModules(
  modules: Modules | undefined
): Map<string, SafeJSSourceModule> {
  return new Map(
    [...normalizeModuleRegistrations(modules).entries()].flatMap(([moduleName, registration]) =>
      registration.filename !== undefined && registration.source !== undefined
        ? [
            {
              moduleName,
              exports: registration.exports,
              filename: registration.filename,
              source: registration.source
            } satisfies SafeJSSourceModule
          ].map((sourceModule) => [moduleName, sourceModule] as const)
        : []
    )
  );
}

export function hasTypedModuleRegistrations(modules: Modules | undefined): boolean {
  return [...normalizeModuleRegistrations(modules).values()].some(
    (registration) => registration.exportTypes.size > 0
  );
}

function normalizeModuleRegistration(
  registration: ModuleRegistration
): NormalizedModuleRegistration {
  if (isExportList(registration)) {
    return {
      asyncExports: new Set(),
      exports: dedupeAndSort(registration),
      exportTypes: new Map()
    };
  }

  const exports = registration.exports ?? [];

  return {
    asyncExports: isExportList(exports) ? new Set() : normalizeAsyncExports(exports),
    exports: dedupeAndSort(isExportList(exports) ? exports : listTypedExports(exports)),
    exportTypes: isExportList(exports) ? new Map() : normalizeExportTypes(exports),
    filename: registration.filename,
    source: registration.source
  };
}

function isExportList(registration: unknown): registration is readonly string[] {
  return Array.isArray(registration);
}

function dedupeAndSort(exportedNames: readonly string[]): string[] {
  return [...new Set(exportedNames)].sort((left, right) => left.localeCompare(right));
}

function listTypedExports(exports: LintModuleExports): string[] {
  return exports instanceof Map ? [...exports.keys()] : Object.keys(exports);
}

function normalizeExportTypes(exports: LintModuleExports): ReadonlyMap<string, string> {
  const entries = exports instanceof Map ? [...exports.entries()] : Object.entries(exports);

  return new Map(
    entries
      .flatMap(([exportName, metadata]) => {
        if (exportName.length === 0) {
          return [];
        }

        const type = typeof metadata === "string" ? metadata : metadata.type;
        return type === undefined ? [] : [[exportName, type] as const];
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeAsyncExports(exports: LintModuleExports): ReadonlySet<string> {
  const entries = exports instanceof Map ? [...exports.entries()] : Object.entries(exports);

  return new Set(
    entries
      .filter(
        ([exportName, metadata]) =>
          exportName.length > 0 && typeof metadata !== "string" && metadata.async === true
      )
      .map(([exportName]) => exportName)
      .sort((left, right) => left.localeCompare(right))
  );
}
