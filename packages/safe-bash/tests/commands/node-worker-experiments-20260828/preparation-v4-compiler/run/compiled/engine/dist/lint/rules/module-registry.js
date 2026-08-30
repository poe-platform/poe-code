import { parseModule } from "../../parse/parser.js";
export function collectImportDeclarations(source, filename) {
    const module = parseModule(source, filename);
    return module.body.flatMap((statement) => statement.type === "ImportDeclaration" ? [statement] : []);
}
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
export function normalizeModules(modules) {
    return new Map([...normalizeModuleRegistrations(modules).entries()].map(([moduleName, registration]) => [
        moduleName,
        registration.exports
    ]));
}
export function normalizeModuleRegistrations(modules) {
    if (modules === undefined) {
        return new Map();
    }
    const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
    const normalized = new Map();
    for (const [moduleName, registration] of entries) {
        normalized.set(moduleName, normalizeModuleRegistration(registration));
    }
    return normalized;
}
export function collectSafeJSSourceModules(modules) {
    return new Map([...normalizeModuleRegistrations(modules).entries()].flatMap(([moduleName, registration]) => registration.filename !== undefined && registration.source !== undefined
        ? [
            {
                moduleName,
                exports: registration.exports,
                filename: registration.filename,
                source: registration.source
            }
        ].map((sourceModule) => [moduleName, sourceModule])
        : []));
}
export function hasTypedModuleRegistrations(modules) {
    return [...normalizeModuleRegistrations(modules).values()].some((registration) => registration.exportTypes.size > 0);
}
function normalizeModuleRegistration(registration) {
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
function isExportList(registration) {
    return Array.isArray(registration);
}
function dedupeAndSort(exportedNames) {
    return [...new Set(exportedNames)].sort((left, right) => left.localeCompare(right));
}
function listTypedExports(exports) {
    return exports instanceof Map ? [...exports.keys()] : Object.keys(exports);
}
function normalizeExportTypes(exports) {
    const entries = exports instanceof Map ? [...exports.entries()] : Object.entries(exports);
    return new Map(entries
        .flatMap(([exportName, metadata]) => {
        if (exportName.length === 0) {
            return [];
        }
        const type = typeof metadata === "string" ? metadata : metadata.type;
        return type === undefined ? [] : [[exportName, type]];
    })
        .sort(([left], [right]) => left.localeCompare(right)));
}
function normalizeAsyncExports(exports) {
    const entries = exports instanceof Map ? [...exports.entries()] : Object.entries(exports);
    return new Set(entries
        .filter(([exportName, metadata]) => exportName.length > 0 && typeof metadata !== "string" && metadata.async === true)
        .map(([exportName]) => exportName)
        .sort((left, right) => left.localeCompare(right)));
}
