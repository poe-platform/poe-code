import { collectImportDeclarations, createUnknownModuleMessage, normalizeModules } from "./module-registry.js";
export function AS004(source, options = {}) {
    const filename = options.filename ?? "<input>";
    const modules = normalizeModules(options.modules);
    const moduleNames = [...modules.keys()].sort((left, right) => left.localeCompare(right));
    return collectImportDeclarations(source, filename).flatMap((declaration) => {
        if (modules.has(declaration.source.value)) {
            return [];
        }
        return [
            {
                code: "AS004",
                severity: "error",
                message: createUnknownModuleMessage(declaration.source.value, moduleNames),
                filename,
                line: declaration.source.span.start.line,
                column: declaration.source.span.start.column,
                span: declaration.source.span
            }
        ];
    });
}
