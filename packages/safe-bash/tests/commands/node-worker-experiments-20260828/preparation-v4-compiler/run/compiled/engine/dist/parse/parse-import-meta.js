export function isImportMetaTokenSequence(importToken, dotToken, metaToken) {
    return (importToken.type === "keyword" &&
        importToken.value === "import" &&
        dotToken.type === "punctuator" &&
        dotToken.value === "." &&
        metaToken.type === "identifier" &&
        metaToken.value === "meta" &&
        importToken.end.offset === dotToken.start.offset &&
        dotToken.end.offset === metaToken.start.offset);
}
export function createImportMeta(importToken, metaToken) {
    return {
        type: "MetaProperty",
        meta: createIdentifier(importToken, "import"),
        property: createIdentifier(metaToken, "meta"),
        span: {
            start: importToken.start,
            end: metaToken.end
        }
    };
}
function createIdentifier(token, name) {
    return {
        type: "Identifier",
        name,
        span: {
            start: token.start,
            end: token.end
        }
    };
}
