export class ExportExtractionError extends Error {
    span;
    constructor(message, span) {
        super(span === undefined
            ? message
            : `${message} At line ${span.start.line}, column ${span.start.column}.`);
        this.name = "ExportExtractionError";
        this.span = span;
    }
}
export function extractTopLevelExports(module) {
    const exports = [];
    let defaultExport;
    for (const statement of module.body) {
        if (statement.type === "ExportDefaultDeclaration") {
            if (defaultExport !== undefined) {
                throw new ExportExtractionError("Module contains more than one export default declaration.", statement.span);
            }
            defaultExport = statement;
            exports.push({
                type: "default",
                name: "default",
                declaration: statement.declaration,
                statement,
                span: statement.span
            });
            continue;
        }
        if (statement.type !== "ExportNamedDeclaration") {
            continue;
        }
        for (const declaration of statement.declaration.declarations) {
            if (declaration.id.type !== "Identifier") {
                throw new ExportExtractionError("Exported const declarations must bind identifiers.", declaration.id.span);
            }
            exports.push({
                type: "named",
                name: declaration.id.name,
                declaration,
                statement,
                span: declaration.span
            });
        }
    }
    return exports;
}
export function createExportNamedDeclaration(exportToken, declaration) {
    return {
        type: "ExportNamedDeclaration",
        declaration,
        span: createSpan(exportToken.start, declaration.span.end)
    };
}
export function createExportDefaultDeclaration(exportToken, declaration) {
    return {
        type: "ExportDefaultDeclaration",
        declaration,
        span: createSpan(exportToken.start, declaration.span.end)
    };
}
function createSpan(start, end) {
    return {
        start: { ...start },
        end: { ...end }
    };
}
