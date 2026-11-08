import { collectImportDeclarations, createUnknownExportMessage, normalizeModules } from "./module-registry.js";
export function AS005(source, options = {}) {
    const filename = options.filename ?? "<input>";
    const modules = normalizeModules(options.modules);
    return collectImportDeclarations(source, filename).flatMap((declaration) => {
        const availableExports = modules.get(declaration.source.value);
        if (availableExports === undefined) {
            return [];
        }
        return declaration.specifiers.flatMap((specifier) => {
            if (specifier.type === "ImportNamespaceSpecifier") {
                return [];
            }
            const importName = specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
            if (availableExports.includes(importName)) {
                return [];
            }
            const span = specifier.type === "ImportDefaultSpecifier"
                ? specifier.local.span
                : specifier.imported.span;
            return [
                {
                    code: "AS005",
                    severity: "error",
                    message: createUnknownExportMessage(declaration.source.value, importName, availableExports),
                    filename,
                    line: span.start.line,
                    column: span.start.column,
                    span
                }
            ];
        });
    });
}
