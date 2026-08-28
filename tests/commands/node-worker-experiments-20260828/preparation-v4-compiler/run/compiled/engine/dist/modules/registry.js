import { attachErrorSpan } from "../error/shape.js";
import { wrapCancelableBindings } from "../interp/cancel.js";
import { readHostOperationPolicy, wrapCallerInjectedBindings } from "../interp/host-bridge.js";
import { registerPendingHostCallPolicy } from "../snapshot/policy.js";
export function createUnknownModuleMessage(moduleName, moduleNames) {
    if (moduleNames.length === 0) {
        return `Unknown module '${moduleName}'. No modules are registered.`;
    }
    return `Unknown module '${moduleName}'. Available modules: ${moduleNames.join(", ")}.`;
}
export function createUnknownExportMessage(moduleName, exportName, availableExports) {
    if (availableExports.length === 0) {
        return `Module '${moduleName}' does not export '${exportName}'. The module exports nothing.`;
    }
    return `Module '${moduleName}' does not export '${exportName}'. Available exports: ${availableExports.join(", ")}.`;
}
export function resolveModuleImports(module, modules, options) {
    const registry = normalizeModuleRegistry(modules);
    const bindings = createBindingRecord();
    const wrappedModules = new Map();
    for (const statement of module.body) {
        if (statement.type !== "ImportDeclaration") {
            continue;
        }
        bindImportDeclaration(statement, registry, wrappedModules, bindings, options);
    }
    return bindings;
}
function bindImportDeclaration(declaration, registry, wrappedModules, bindings, options) {
    const moduleName = declaration.source.value;
    const moduleExports = registry.get(moduleName);
    if (moduleExports === undefined) {
        if (options.allowMissing)
            return;
        throw createModuleImportError(createUnknownModuleMessage(moduleName, [...registry.keys()]), declaration.source.span);
    }
    const wrappedExports = wrappedModules.get(moduleName) ??
        wrapCancelableBindings(wrapCallerInjectedBindings(Object.fromEntries(moduleExports), {
            budget: options.budget,
            hostCalls: options.hostCalls,
            moduleId: moduleName,
            signal: options.signal
        }), options.signal);
    wrappedModules.set(moduleName, wrappedExports);
    for (const specifier of declaration.specifiers) {
        const localName = specifier.local.name;
        if (Object.hasOwn(bindings, localName)) {
            throw createModuleImportError(`Cannot redeclare imported binding '${localName}'.`, specifier.local.span);
        }
        if (options.allowMissing && specifier.type !== "ImportNamespaceSpecifier") {
            const exportName = specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
            if (!Object.hasOwn(wrappedExports, exportName))
                continue;
        }
        bindings[localName] = resolveImportSpecifier(moduleName, specifier, wrappedExports);
    }
}
function resolveImportSpecifier(moduleName, specifier, wrappedExports) {
    if (specifier.type === "ImportNamespaceSpecifier") {
        return createBindingRecord(wrappedExports);
    }
    const exportName = specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
    const exportedValue = wrappedExports[exportName];
    if (exportedValue !== undefined || Object.hasOwn(wrappedExports, exportName)) {
        return exportedValue;
    }
    throw createModuleImportError(createUnknownExportMessage(moduleName, exportName, Object.keys(wrappedExports).sort()), specifier.span);
}
function createModuleImportError(message, span) {
    const error = new Error(message);
    attachErrorSpan(error, span);
    return error;
}
function normalizeModuleRegistry(modules) {
    if (modules === undefined) {
        return new Map();
    }
    const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
    const registry = new Map(entries
        .map(([moduleName, moduleExports]) => [moduleName, normalizeModuleExports(moduleExports)])
        .sort(([left], [right]) => left.localeCompare(right)));
    registerModuleHostOperationPolicies(registry);
    return registry;
}
function registerModuleHostOperationPolicies(registry) {
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
function normalizeModuleExports(moduleExports) {
    const entries = moduleExports instanceof Map ? [...moduleExports.entries()] : Object.entries(moduleExports);
    return new Map(entries
        .filter(([exportName]) => exportName.length > 0)
        .sort(([left], [right]) => left.localeCompare(right)));
}
function createBindingRecord(entries) {
    return Object.assign(Object.create(null), entries);
}
