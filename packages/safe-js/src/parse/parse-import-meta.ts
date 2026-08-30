import type { Token } from "./tokenizer.js";
import type { Identifier, MetaProperty } from "./parser.js";

export function isImportMetaTokenSequence(
  importToken: Token,
  dotToken: Token,
  metaToken: Token
): boolean {
  return (
    importToken.type === "keyword" &&
    importToken.value === "import" &&
    dotToken.type === "punctuator" &&
    dotToken.value === "." &&
    metaToken.type === "identifier" &&
    metaToken.value === "meta" &&
    importToken.end.offset === dotToken.start.offset &&
    dotToken.end.offset === metaToken.start.offset
  );
}

export function createImportMeta(importToken: Token, metaToken: Token): MetaProperty {
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

function createIdentifier<TName extends string>(
  token: Token,
  name: TName
): Identifier & { name: TName } {
  return {
    type: "Identifier",
    name,
    span: {
      start: token.start,
      end: token.end
    }
  };
}
