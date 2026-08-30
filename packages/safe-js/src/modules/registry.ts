import { attachErrorSpan } from "../error/shape.js";
import type { Budget, CompileOwner } from "../interp/budget.js";
import type { HostCallJournal } from "../interp/host-call.js";
import { wrapCancelableBindings } from "../interp/cancel.js";
import {
  readHostOperationPolicy,
  wrapCallerInjectedBindings,
  type CallerInjectedBinding
} from "../interp/host-bridge.js";
import type { SandboxValue } from "../interp/values.js";
import type {
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Module,
  SourceSpan
} from "../parse/parser.js";
import { registerPendingHostCallPolicy } from "../snapshot/policy.js";

export type ModuleExports =
  | ReadonlyMap<string, CallerInjectedBinding>
  | Record<string, CallerInjectedBinding>;

export type ModuleRegistry = ReadonlyMap<string, ModuleExports> | Record<string, ModuleExports>;

type NormalizedModuleRegistry = Map<string, Map<string, CallerInjectedBinding>>;

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

export function resolveModuleImports(
  module: Module,
  modules: ModuleRegistry | undefined,
  options: {
    budget: Budget;
    compileOwner?: CompileOwner;
    hostCalls?: HostCallJournal;
    signal?: AbortSignal;
    allowMissing?: boolean;
  }
): Record<string, SandboxValue> {
  const registry = normalizeModuleRegistry(modules);
  const bindings = createBindingRecord();
  const wrappedModules = new Map<string, Record<string, SandboxValue>>();

  for (const statement of module.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }

    bindImportDeclaration(statement, registry, wrappedModules, bindings, options);
  }

  return bindings;
}

function bindImportDeclaration(
  declaration: ImportDeclaration,
  registry: NormalizedModuleRegistry,
  wrappedModules: Map<string, Record<string, SandboxValue>>,
  bindings: Record<string, SandboxValue>,
  options: {
    budget: Budget;
    compileOwner?: CompileOwner;
    hostCalls?: HostCallJournal;
    signal?: AbortSignal;
    allowMissing?: boolean;
  }
): void {
  const moduleName = declaration.source.value;
  const moduleExports = registry.get(moduleName);

  if (moduleExports === undefined) {
    if (options.allowMissing) return;
    throw createModuleImportError(
      createUnknownModuleMessage(moduleName, [...registry.keys()]),
      declaration.source.span
    );
  }

  const wrappedExports =
    wrappedModules.get(moduleName) ??
    createBindingRecord(
      wrapCancelableBindings(
        wrapCallerInjectedBindings(Object.fromEntries(moduleExports), {
          budget: options.budget,
          compileOwner: options.compileOwner,
          hostCalls: options.hostCalls,
          moduleId: moduleName,
          signal: options.signal
        }),
        options.signal
      )
    );

  wrappedModules.set(moduleName, wrappedExports);

  for (const specifier of declaration.specifiers) {
    const localName = specifier.local.name;

    if (Object.hasOwn(bindings, localName)) {
      throw createModuleImportError(
        `Cannot redeclare imported binding '${localName}'.`,
        specifier.local.span
      );
    }

    if (options.allowMissing && specifier.type !== "ImportNamespaceSpecifier") {
      const exportName =
        specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
      if (!Object.hasOwn(wrappedExports, exportName)) continue;
    }
    bindings[localName] = resolveImportSpecifier(moduleName, specifier, wrappedExports);
  }
}

function resolveImportSpecifier(
  moduleName: string,
  specifier: ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier,
  wrappedExports: Record<string, SandboxValue>
): SandboxValue {
  if (specifier.type === "ImportNamespaceSpecifier") {
    return wrappedExports;
  }

  const exportName =
    specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
  const exportedValue = wrappedExports[exportName];

  if (exportedValue !== undefined || Object.hasOwn(wrappedExports, exportName)) {
    return exportedValue;
  }

  throw createModuleImportError(
    createUnknownExportMessage(moduleName, exportName, Object.keys(wrappedExports).sort()),
    specifier.span
  );
}

function createModuleImportError(message: string, span: SourceSpan): Error {
  const error = new Error(message);
  attachErrorSpan(error, span);
  return error;
}

function normalizeModuleRegistry(modules: ModuleRegistry | undefined): NormalizedModuleRegistry {
  if (modules === undefined) {
    return new Map();
  }

  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
  const registry = new Map(
    entries
      .map(
        ([moduleName, moduleExports]) =>
          [moduleName, normalizeModuleExports(moduleExports)] as const
      )
      .sort(([left], [right]) => left.localeCompare(right))
  );

  registerModuleHostOperationPolicies(registry);
  return registry;
}

function registerModuleHostOperationPolicies(registry: NormalizedModuleRegistry): void {
  for (const [moduleId, moduleExports] of registry) {
    for (const [operation, value] of moduleExports) {
      if (typeof value !== "function") {
        continue;
      }

      const policy = readHostOperationPolicy(value);
      if (policy !== undefined) {
        registerPendingHostCallPolicy({ moduleId, operation, policy });
      }
    }
  }
}

function normalizeModuleExports(moduleExports: ModuleExports): Map<string, CallerInjectedBinding> {
  const entries =
    moduleExports instanceof Map ? [...moduleExports.entries()] : Object.entries(moduleExports);

  return new Map(
    entries
      .filter(([exportName]) => exportName.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function createBindingRecord<TValue extends SandboxValue>(
  entries?: Record<string, TValue>
): Record<string, TValue> {
  return Object.assign(Object.create(null) as Record<string, TValue>, entries);
}
