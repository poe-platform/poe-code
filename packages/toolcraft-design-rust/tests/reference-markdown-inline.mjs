import {readFileSync} from "node:fs";

// Export private helpers from the original built parser without changing algorithms.
const source=readFileSync(new URL("../../toolcraft-design/dist/terminal-markdown/parser/inline.js",import.meta.url),"utf8");
const names=["parseInlineCode","parseBracketedLabel","parseLinkDestination","parseAutolink","parseLiteralAutolink","parseInlineHtmlTag","decodeEscapes","createOffsetMap","INLINE_HTML_TAGS","parseDelimiter","matchDelimiterPairs","buildInlineNodes","isDelimiterWhitespace","isDelimiterPunctuation"];
export const referenceInline=await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport {${names.join(",")}};`).toString("base64")}`);
