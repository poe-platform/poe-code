import { attachErrorSpan } from "../error/shape.js";
import { createModuleNamespace } from "../interp/module-namespace.js";
import type { Budget, CompileOwner } from "../interp/budget.js";
import type { HostCallJournal } from "../interp/host-call.js";
import { wrapCancelableBindings } from "../interp/cancel.js";
import {
  readHostOperationPolicy,
  wrapCallerInjectedBindings,
  type RealmBridge,
  type CallerInjectedBinding
} from "../interp/host-bridge.js";
import type { SandboxValue, SandboxClosure } from "../interp/values.js";
import type { ModuleFunctionOrigin } from "../interp/module-function-origin.js";
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

export type ModuleEnvironment = {
  available: string[];
  namespaces: Record<string, SandboxValue>;
};

export type ModuleEnvironmentOptions = {
  budget: Budget;
  realm?: RealmBridge;
  wrappedModules?: Map<string, Record<string, SandboxValue>>;
  compileOwner?: CompileOwner;
  hostCalls?: HostCallJournal;
  signal?: AbortSignal;
  prepareNamespace?: (namespace: Record<string,SandboxValue>, moduleName: string) => Record<string,SandboxValue>;
};

const moduleEnvironments = new WeakMap<ModuleEnvironment, {
  registry: NormalizedModuleRegistry;
  options: ModuleEnvironmentOptions;
  prepared: Set<string>;
  capabilities: Map<string, SandboxClosure>;
}>();

export function createModuleEnvironment(modules: ModuleRegistry | undefined, options: ModuleEnvironmentOptions, restored?: ModuleEnvironment): ModuleEnvironment {
  const registry = normalizeModuleRegistry(modules);
  const environment: ModuleEnvironment = restored ?? {
    available: [...registry.keys()],
    namespaces: createBindingRecord(Object.fromEntries(options.wrappedModules ?? []))
  };
  moduleEnvironments.set(environment, {registry,options,prepared:new Set(),capabilities:new Map()});
  return environment;
}

export function resolveModuleNamespace(environment: ModuleEnvironment, moduleName: string, prepare = true): Record<string, SandboxValue> {
  const backend = moduleEnvironments.get(environment);
  if (backend === undefined) throw new TypeError("Module environment has not been attached to a runtime.");
  if (!environment.available.includes(moduleName))
    throw new Error(createUnknownModuleMessage(moduleName, environment.available));
  const {options} = backend;
  if (Object.hasOwn(environment.namespaces,moduleName)) {
    let namespace = environment.namespaces[moduleName] as Record<string, SandboxValue>;
    if (prepare && options.prepareNamespace !== undefined && !backend.prepared.has(moduleName)) {
      namespace = options.prepareNamespace(namespace,moduleName);
      environment.namespaces[moduleName] = namespace;
      options.wrappedModules?.set(moduleName,namespace);
      backend.prepared.add(moduleName);
    }
    return namespace;
  }
  const exports = backend.registry.get(moduleName);
  if (exports === undefined) throw new Error(createUnknownModuleMessage(moduleName,[...backend.registry.keys()]));
  let namespace = createModuleNamespace(wrapCancelableBindings(
    wrapCallerInjectedBindings(Object.fromEntries(exports), {
      realm: options.realm, budget: options.budget, compileOwner: options.compileOwner,
      hostCalls: options.hostCalls, moduleId: moduleName, signal: options.signal,
      moduleCapabilities: backend.capabilities
    }),options.signal
  ));
  if (prepare && options.prepareNamespace !== undefined) {
    namespace = options.prepareNamespace(namespace,moduleName);
    backend.prepared.add(moduleName);
  }
  environment.namespaces[moduleName] = namespace;
  options.wrappedModules?.set(moduleName,namespace);
  return namespace;
}

export function resolveModuleFunction(environment: ModuleEnvironment, origin: ModuleFunctionOrigin): SandboxClosure {
  resolveModuleNamespace(environment, origin.module, false);
  const capability = moduleEnvironments.get(environment)!.capabilities.get(JSON.stringify([origin.module, ...origin.path]));
  if (capability === undefined) throw new TypeError(`Missing module function '${origin.module}:${origin.path.join(".")}'.`);
  return capability;
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

export function resolveModuleImports(
  module: Module,
  modules: ModuleRegistry | undefined,
  options: ModuleEnvironmentOptions & {
    environment?: ModuleEnvironment;
    allowMissing?: boolean;
  }
): Record<string, SandboxValue> {
  const environment = options.environment ?? createModuleEnvironment(modules,options);
  const bindings = createBindingRecord();

  for (const statement of module.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }

    bindImportDeclaration(statement, environment, bindings, options);
  }

  return bindings;
}

function bindImportDeclaration(
  declaration: ImportDeclaration,
  environment: ModuleEnvironment,
  bindings: Record<string, SandboxValue>,
  options: {
    budget: Budget;
    realm?: RealmBridge;
    compileOwner?: CompileOwner;
    hostCalls?: HostCallJournal;
    signal?: AbortSignal;
    allowMissing?: boolean;
  }
): void {
  const moduleName = declaration.source.value;
  if (!environment.available.includes(moduleName)) {
    if (options.allowMissing) return;
    throw createModuleImportError(
      createUnknownModuleMessage(moduleName, environment.available),
      declaration.source.span
    );
  }

  const wrappedExports = resolveModuleNamespace(environment,moduleName);

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
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function createBindingRecord<TValue extends SandboxValue>(
  entries?: Record<string, TValue>
): Record<string, TValue> {
  return Object.assign(Object.create(null) as Record<string, TValue>, entries);
}
