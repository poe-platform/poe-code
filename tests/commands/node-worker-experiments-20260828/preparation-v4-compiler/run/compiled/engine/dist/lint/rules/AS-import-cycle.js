import { ParseError } from "../../parse/format-error.js";
import { DisallowedSyntaxError } from "../../parse/parser.js";
import { collectSafeJSSourceModules, collectImportDeclarations } from "./module-registry.js";
export function AS_IMPORT_CYCLE(source, options = {}) {
    const filename = options.filename ?? "<input>";
    const sourceModules = collectSafeJSSourceModules(options.modules);
    if (sourceModules.size === 0) {
        return [];
    }
    const dependencyGraph = new Map();
    const importEdges = [];
    for (const sourceModule of sourceModules.values()) {
        const moduleSource = sourceModule.filename === filename ? source : sourceModule.source;
        const declarations = collectImportDeclarationsForCycleRule(moduleSource, sourceModule.filename);
        const targetModuleNames = declarations
            .map((declaration) => declaration.source.value)
            .filter((targetModuleName) => sourceModules.has(targetModuleName));
        dependencyGraph.set(sourceModule.moduleName, [...new Set(targetModuleNames)]);
        importEdges.push(...declarations.flatMap((declaration) => {
            const targetModuleName = declaration.source.value;
            return sourceModules.has(targetModuleName)
                ? [
                    {
                        declaration,
                        filename: sourceModule.filename,
                        moduleName: sourceModule.moduleName,
                        targetModuleName
                    }
                ]
                : [];
        }));
    }
    return importEdges.flatMap((edge) => {
        const cyclePath = findPathToModule(edge.targetModuleName, edge.moduleName, dependencyGraph, new Set());
        return cyclePath === undefined
            ? []
            : [
                createDiagnostic(edge.declaration.source.span, edge.targetModuleName, [edge.moduleName, ...cyclePath], edge.filename)
            ];
    });
}
function collectImportDeclarationsForCycleRule(source, filename) {
    try {
        return collectImportDeclarations(source, filename);
    }
    catch (error) {
        if (error instanceof ParseError || error instanceof DisallowedSyntaxError) {
            return [];
        }
        throw error;
    }
}
function createDiagnostic(span, importedModuleName, cyclePath, filename) {
    return {
        code: "AS-IMPORT-CYCLE",
        severity: "error",
        message: `Import from '${importedModuleName}' participates in a cyclic dependency: ${cyclePath.join(" -> ")}.`,
        filename,
        line: span.start.line,
        column: span.start.column,
        span
    };
}
function findPathToModule(currentModuleName, targetModuleName, dependencyGraph, visited) {
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
